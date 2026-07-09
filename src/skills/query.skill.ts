import { LuaSkill, LuaTool } from 'lua-cli';
import { z } from 'zod';
import { normGrade, POST_GRADES_SUMMARY } from '../lib/grades';
import { bagsToMt, round } from '../lib/units';
import { computePricing, PriceDimension } from '../lib/pricing';
import { getSnapshot, loadBlendRecipes } from './store';

/**
 * Q&A over computed snapshots: position lookups and what-if checks. These
 * tools return the numbers; the agent phrases the answer.
 */

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Defaults to the latest snapshot');

function findGradeKey(byGrade: Record<string, any>, grade: string): string | undefined {
  const target = normGrade(grade);
  return (
    Object.keys(byGrade).find((k) => normGrade(k) === target) ??
    Object.keys(byGrade).find((k) => normGrade(k).includes(target))
  );
}

class QueryPosition implements LuaTool {
  name = 'query-position';
  description =
    'Read the computed position: total or per-grade net (longs/shorts/net bags + MT), shorts by delivery month, offers, hedge lines, and data freshness.';
  inputSchema = z.object({
    positionDate: dateField,
    grade: z.string().optional().describe('POST grade (fuzzy, e.g. "AB FAQ" → POST 16 FAQ block) — omit for the full position'),
    month: z.string().regex(/^\d{4}\/\d{2}$/).optional().describe('Delivery month filter for the shorts breakdown'),
  });

  async execute(input: { positionDate?: string; grade?: string; month?: string }) {
    const snap = await getSnapshot(input.positionDate);
    if (!snap) throw new Error('No position snapshot exists yet — ingest the exports first.');
    const d = snap.data;
    const freshness = {
      positionDate: d.positionDate,
      updatedAt: d.updatedAt,
      computed: { theoretical: !!d.theoretical, forwardSales: !!d.forwardSales, net: !!d.net, futs: !!d.futs },
      pendingBlendCount: (d.pendingBlends ?? []).length,
    };
    if (!d.net) return { freshness, note: 'Net position not computed yet — run the compute chain first.' };

    if (input.grade) {
      const key = findGradeKey(d.net.byGrade, input.grade);
      if (!key) return { freshness, error: `No grade matching "${input.grade}". Known: ${POST_GRADES_SUMMARY.join(', ')}` };
      const g = d.net.byGrade[key];
      const monthRow = (d.forwardSales?.matrix ?? {})[key] ?? {};
      return {
        freshness,
        grade: key,
        longsBags: round(g.theoretical),
        shortsBags: round(g.forwardSales),
        netBags: round(g.net),
        netMt: round(bagsToMt(g.net)),
        shortsByMonth: input.month
          ? { [input.month]: round(monthRow[input.month] || 0) }
          : Object.fromEntries(Object.entries(monthRow).map(([m, v]) => [m, round(v as number)])),
        horizon: d.net.horizon,
      };
    }

    return {
      freshness,
      horizon: d.net.horizon,
      total: {
        longsBags: round(d.net.total.theoretical),
        shortsBags: round(d.net.total.forwardSales),
        netBags: round(d.net.total.net),
        netMt: round(bagsToMt(d.net.total.net)),
      },
      byGrade: Object.fromEntries(
        Object.entries(d.net.byGrade as Record<string, any>)
          .filter(([, v]) => v.theoretical !== 0 || v.forwardSales !== 0)
          .map(([g, v]) => [g, { longs: round(v.theoretical), shorts: round(v.forwardSales), net: round(v.net) }])
      ),
      offers: d.offers,
      hedge: d.futs
        ? Object.fromEntries(
            (d.futs.order as string[]).map((k) => [
              k,
              { mt: d.futs.lines[k].mt != null ? round(d.futs.lines[k].mt) : null, lots: d.futs.lines[k].lots != null ? round(d.futs.lines[k].lots) : null },
            ])
          )
        : undefined,
    };
  }
}

class WhatIf implements LuaTool {
  name = 'what-if';
  description =
    'Check a hypothetical sale: "can I sell N bags of grade G for month M without going short?" Returns the net before/after, per month cumulative.';
  inputSchema = z.object({
    grade: z.string().describe('POST grade to sell (fuzzy match ok)'),
    bags: z.number().positive().describe('Bags the trader wants to sell'),
    month: z.string().regex(/^\d{4}\/\d{2}$/).describe('Proposed delivery month YYYY/MM'),
    positionDate: dateField,
  });

  async execute(input: { grade: string; bags: number; month: string; positionDate?: string }) {
    const snap = await getSnapshot(input.positionDate);
    if (!snap?.data?.net) throw new Error('Net position not computed yet — run the compute chain first.');
    const d = snap.data;
    const key = findGradeKey(d.net.byGrade, input.grade);
    if (!key) throw new Error(`No grade matching "${input.grade}".`);

    const g = d.net.byGrade[key];
    const monthRow: Record<string, number> = (d.forwardSales?.matrix ?? {})[key] ?? {};
    const horizon: string[] = d.net.horizon ?? [];

    // cumulative net through each horizon month, with the hypothetical sale added
    const months = [...new Set([...horizon, input.month])].sort();
    let cumulative = g.theoretical;
    const timeline: Array<{ month: string; committedBags: number; cumulativeNetBags: number }> = [];
    for (const mo of months) {
      const committed = (monthRow[mo] || 0) - (mo === input.month ? input.bags : 0);
      cumulative += committed;
      timeline.push({ month: mo, committedBags: round(committed), cumulativeNetBags: round(cumulative) });
    }

    const netAfter = g.net - input.bags;
    const firstShortMonth = timeline.find((t) => t.cumulativeNetBags < 0)?.month ?? null;
    return {
      positionDate: d.positionDate,
      grade: key,
      proposal: { bags: input.bags, month: input.month },
      netBeforeBags: round(g.net),
      netAfterBags: round(netAfter),
      goesShort: netAfter < 0,
      firstShortMonth,
      timeline,
      caveats: [
        ...((d.pendingBlends ?? []).length ? [`${d.pendingBlends.length} sale(s) still pending blend confirmation are excluded.`] : []),
        'Timeline assumes stock is fully available today (theoretical stock, no per-month production phasing).',
      ],
    };
  }
}

class PriceAnalytics implements LuaTool {
  name = 'price-analytics';
  description =
    'Average price level of the shorts book: SMT-weighted contract differential AND FOB-equivalent differential (USc/lb vs NY KC) — overall or by sold grade, POST grade, client, delivery month, or fixation month; plus the fixed vs price-to-be-fixed split. No cost basis, P&L, or market prices.';
  inputSchema = z.object({
    positionDate: dateField,
    dimension: z
      .enum(['soldGrade', 'postGrade', 'client', 'deliveryMonth', 'fixMonth'])
      .optional()
      .describe('Break the averages down by this dimension; omit for the overall book'),
    grade: z.string().optional().describe('With dimension=postGrade: filter to POST grades fuzzy-matching this (e.g. "grinder")'),
    client: z.string().optional().describe('Filter sales to one client before averaging'),
    month: z.string().regex(/^\d{4}\/\d{2}$/).optional().describe('Filter sales to one delivery month YYYY/MM'),
    fixMonth: z.string().optional().describe('Filter sales to one futures fixation month, e.g. KCU/2026'),
  });

  async execute(input: {
    positionDate?: string;
    dimension?: PriceDimension;
    grade?: string;
    client?: string;
    month?: string;
    fixMonth?: string;
  }) {
    const snap = await getSnapshot(input.positionDate);
    if (!snap) throw new Error('No position snapshot exists yet — ingest the exports first.');
    const d = snap.data;
    let sales: any[] = d.sales ?? [];
    if (sales.length === 0) throw new Error('This snapshot has no sales — ingest the logistics report first.');

    if (input.client) sales = sales.filter((s) => (s.client ?? '').toUpperCase().includes(input.client!.toUpperCase()));
    if (input.month) sales = sales.filter((s) => s.month === input.month);
    if (input.fixMonth) sales = sales.filter((s) => (s.sFixDte ?? '').toUpperCase() === input.fixMonth!.toUpperCase());
    if (sales.length === 0) return { positionDate: d.positionDate, note: 'No sales match that filter.' };

    const blends = input.dimension === 'postGrade' ? await loadBlendRecipes() : undefined;
    const result = computePricing(sales, { dimension: input.dimension, blends });

    let byBucket: Record<string, any> | undefined = result.byBucket;
    if (byBucket && input.dimension === 'postGrade') {
      if (input.grade) {
        const target = normGrade(input.grade);
        byBucket = Object.fromEntries(Object.entries(byBucket).filter(([g]) => normGrade(g).includes(target)));
        if (Object.keys(byBucket).length === 0)
          return { positionDate: d.positionDate, note: `No POST grade matching "${input.grade}" carries priced shorts.` };
      }
      // postGrade buckets are weighted by blend-allocated BAGS, not MT — name the field accordingly
      byBucket = Object.fromEntries(
        Object.entries(byBucket).map(([g, b]: [string, any]) => [
          g,
          { contracts: b.contracts, allocatedBags: b.smt, contractDifUscLb: b.contractDifUscLb, fobDifUscLb: b.fobDifUscLb },
        ])
      );
    }

    return {
      positionDate: d.positionDate,
      demo: d.demo === true || undefined,
      scope: 'unallocated shorts book only (differentials vs NY KC, USc/lb)',
      overall: result.overall,
      byBucket,
      coverage: result.coverage,
      caveats: [
        'Contract dif is on each sale\'s own Incoterm; FOB dif is the FOB-equivalent — present BOTH, never just one.',
        `Price-to-be-fixed volume: ${result.overall.ptbf.smt} MT across ${result.overall.ptbf.contracts} contracts (differential agreed, futures leg open).`,
        ...(input.dimension === 'postGrade'
          ? ['POST-grade figures attribute each contract\'s differential across its blend grades (weighted by allocated bags).']
          : []),
        ...(result.coverage.unpriced > 0
          ? [`${result.coverage.unpriced} sale(s) carry no differential and are excluded: ${result.coverage.unpricedContracts.join(', ')}`]
          : []),
      ],
    };
  }
}

export const querySkill = new LuaSkill({
  name: 'position-query',
  description: 'Answer position questions and what-ifs from the computed snapshots.',
  context: `Answering questions about the position.
- query-position for "what's my net position", "how short am I on AB FAQ", "shorts by month for grinders". Always mention the position date and any pending blend confirmations.
- what-if for "can I sell N bags of X for month M" — report netAfter and, if it goes short, the first month it happens. Never turn this into trade advice; state the numbers.
- price-analytics for "at what price level am I short", "average differential on grinders", "how much is fixed vs to-be-fixed". "Price level" on this desk = differential vs the NY KC futures in USc/lb. ALWAYS present the contract differential and the FOB-equivalent side by side — neither is the headline. State the fixed vs price-to-be-fixed split and any excluded (unpriced) sales. It covers the unallocated shorts book only: no purchase cost basis, no P&L or mark-to-market (no market prices exist in the data), no price history — say so when asked.
- Grades are matched fuzzily ("AB FAQ" → POST 16 FAQ); confirm the resolved grade in the answer.
- Quote bags by default; add MT when the trader asks or the number is hedge-related.
- Never label net values as "longs": longs = theoretical stock, net = longs + shorts. Say which one you're quoting.`,
  tools: [new QueryPosition(), new WhatIf(), new PriceAnalytics()],
});
