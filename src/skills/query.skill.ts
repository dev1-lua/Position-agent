import { LuaSkill, LuaTool } from 'lua-cli';
import { z } from 'zod';
import { normGrade, POST_GRADES_SUMMARY } from '../lib/grades';
import { monthTotals, explainGradeContributions, horizonNote } from '../lib/shorts';
import { resolveOfferQuery } from '../lib/netposition';
import { bagsToMt, round } from '../lib/units';
import { computePricing, distinctContractsForGrades, PriceDimension } from '../lib/pricing';
import { computeClientExposure, computeShipmentStatus } from '../lib/book';
import { computeCertExposure } from '../lib/cert';
import { computeStockAnalytics, StockDimension } from '../lib/stockanalytics';
import { computePositionInsights } from '../lib/insights';
import { citeLine, staleNotice } from '../lib/cite';
import { getSnapshot, loadBlendRecipes } from './store';

/** Provenance line for a tool result — the agent must quote it verbatim. */
function cite(tool: string, d: any, sources: string[], derivation?: string): string {
  return citeLine({ tool, positionDate: d.positionDate, demo: d.demo === true, updatedAt: d.updatedAt, sources, derivation });
}
/** Spreadable ready-made stale banner — {} when the snapshot is current (QA F2: model-composed banners drifted). */
function staleField(d: any): { staleNotice?: string } {
  const s = staleNotice(d.positionDate);
  return s ? { staleNotice: s } : {};
}
const SRC_POSITION = ['XBS Current Stock (longs)', 'SOL ReportLogistic (shorts)'];
const SRC_LOGISTICS = ['SOL ReportLogistic'];
/** The shorts allocation formula, quoted in derivations (BASE FILE col AW). */
const SHORTS_FORMULA = 'Σ "S.MT" × blend fraction × 1000/60';
/** Hedge-pot derivation, quoted whenever hedge/futs lines are surfaced (futs sheet B12–B26). */
const HEDGE_DERIVATION =
  'hedge: Kenyacof Net = Stock hedgeable + Kenyacof futs (manual) + KenyaZZ (manual); Sucafina = SOL DailyNetPosition futures rows; Δ Hedge (KENY_AR_DYN) = manual pot input';

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
    grade: z
      .string()
      .optional()
      .describe(
        'POST grade or offer name, passed EXACTLY as the trader typed it (never strip or add the POST prefix, never normalize) — the tool does all fuzzy matching itself. Omit for the full position.'
      ),
    month: z
      .string()
      .regex(/^\d{4}\/\d{2}$/)
      .optional()
      .describe('Delivery month YYYY/MM. Alone → shorts by grade for that month; with grade → that grade-month cell.'),
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
    // Ready-made banner (or absent when current) — the persona prepends it
    // verbatim on EVERY answer, including error paths (QA F2: model-composed
    // banners drifted or vanished).
    const stale = staleNotice(d.positionDate);
    if (!d.net) return { ...(stale ? { staleNotice: stale } : {}), freshness, note: 'Net position not computed yet — run the compute chain first.' };
    const matrix: Record<string, Record<string, number>> = d.forwardSales?.matrix ?? {};

    if (input.grade) {
      const key = findGradeKey(d.net.byGrade, input.grade);
      if (key) {
        const g = d.net.byGrade[key];
        const monthRow = matrix[key] ?? {};
        return {
          ...(stale ? { staleNotice: stale } : {}),
          freshness,
          grade: key,
          // fuzzy input only ("16 faq" → POST 16 FAQ); absent when the trader typed the exact name (QA F4)
          ...(normGrade(input.grade) !== normGrade(key) ? { resolvedFrom: input.grade } : {}),
          longsBags: round(g.theoretical),
          shortsBags: round(g.forwardSales),
          netBags: round(g.net),
          netMt: round(bagsToMt(g.net)),
          shortsByMonth: input.month
            ? { [input.month]: round(monthRow[input.month] || 0) }
            : Object.fromEntries(Object.entries(monthRow).map(([m, v]) => [m, round(v as number)])),
          horizon: d.net.horizon,
          notes: [horizonNote(d.net.horizon, monthRow)],
          cite: cite(
            this.name,
            d,
            SRC_POSITION,
            `Forward Sales row "${key}": ${SHORTS_FORMULA} per delivery month; longs = stock-counter theoretical for "${key}" (Summary!C)`
          ),
        };
      }
      // not a grade — maybe an offer name (AB FAQ = 16 FAQ ×1 + 15 FAQ ×0.5 …)
      const offer = resolveOfferQuery(input.grade);
      if (!offer)
        return {
          ...(stale ? { staleNotice: stale } : {}),
          freshness,
          error: `No grade or offer matching "${input.grade}". Grades: ${POST_GRADES_SUMMARY.join(', ')}. Offers: TOP, PLUS, AA FAQ, AB FAQ, ABC FAQ, GRINDER 14+, GRINDER 13-.`,
        };
      const members = offer.members.map(([grade, weight]) => {
        const g = d.net.byGrade[grade] ?? { theoretical: 0, forwardSales: 0, net: 0 };
        return { grade, weight, longsBags: round(g.theoretical), shortsBags: round(g.forwardSales), netBags: round(g.net) };
      });
      const weightedByMonth: Record<string, number> = {};
      for (const [grade, weight] of offer.members)
        for (const [mo, v] of Object.entries(matrix[grade] ?? {}))
          weightedByMonth[mo] = round((weightedByMonth[mo] || 0) + (v as number) * weight, 2);
      const sum = (f: (m: (typeof members)[0]) => number) => round(members.reduce((s, m) => s + f(m) * m.weight, 0));
      const result: Record<string, unknown> = {
        ...(stale ? { staleNotice: stale } : {}),
        freshness,
        offer: offer.offer,
        offerBags: d.offers?.[offer.offer]?.bags ?? sum((m) => m.netBags),
        offerMt: d.offers?.[offer.offer]?.mt,
        weighted: { longsBags: sum((m) => m.longsBags), shortsBags: sum((m) => m.shortsBags), netBags: sum((m) => m.netBags) },
        members,
        shortsByMonth: input.month ? { [input.month]: weightedByMonth[input.month] ?? 0 } : weightedByMonth,
        horizon: d.net.horizon,
        notes: [
          `"${offer.offer}" is an offer roll-up, not a single grade: ${offer.members.map(([g, w]) => `${g} ×${w}`).join(' + ')}.`,
          horizonNote(d.net.horizon, weightedByMonth),
        ],
        cite: cite(
          this.name,
          d,
          SRC_POSITION,
          `Offers block: ${offer.offer} = ${offer.members.map(([g, w]) => `${w}×net["${g}"]`).join(' + ')}; member shorts = ${SHORTS_FORMULA}`
        ),
      };
      return result;
    }

    if (input.month) {
      // month alone → shorts by grade for that delivery month
      const byGradeMonth = Object.fromEntries(
        Object.entries(matrix)
          .map(([g, row]) => [g, round((row as Record<string, number>)[input.month!] || 0)])
          .filter(([, v]) => v !== 0)
      );
      const totalBags = round(Object.values(byGradeMonth).reduce((s: number, v) => s + (v as number), 0));
      const known = Object.keys(monthTotals(matrix));
      return {
        ...(stale ? { staleNotice: stale } : {}),
        freshness,
        month: input.month,
        shortsByGrade: byGradeMonth,
        totalShortsBags: totalBags,
        totalShortsMt: round(bagsToMt(totalBags)),
        ...(known.includes(input.month) ? {} : { note: `No shorts in ${input.month}. Months with shorts: ${known.join(', ')}.` }),
        horizon: d.net.horizon,
        notes: [horizonNote(d.net.horizon, monthTotals(matrix))],
        cite: cite(
          this.name,
          d,
          SRC_LOGISTICS,
          `Forward Sales column "${input.month}" summed per grade; each cell = ${SHORTS_FORMULA}`
        ),
      };
    }

    const byMonth = monthTotals(matrix);
    const hedge = d.futs
      ? Object.fromEntries(
          (d.futs.order as string[]).map((k) => [
            k,
            { mt: d.futs.lines[k].mt != null ? round(d.futs.lines[k].mt) : null, lots: d.futs.lines[k].lots != null ? round(d.futs.lines[k].lots) : null },
          ])
        )
      : undefined;
    return {
      ...(stale ? { staleNotice: stale } : {}),
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
      shortsByMonth: Object.fromEntries(Object.entries(byMonth).map(([m, v]) => [m, round(v)])),
      offers: d.offers,
      hedge,
      insights: computePositionInsights({
        positionDate: d.positionDate,
        horizon: d.net.horizon,
        shortsByMonth: byMonth,
        byGrade: d.net.byGrade,
        hedgeLines: hedge,
      }),
      notes: [horizonNote(d.net.horizon, byMonth)],
      cite: cite(
        this.name,
        d,
        d.futs ? [...SRC_POSITION, 'SOL DailyNetPosition (hedge)'] : SRC_POSITION,
        d.futs
          ? `net[grade] = stock-counter theoretical (Summary!C) + ${SHORTS_FORMULA} over the horizon; ${HEDGE_DERIVATION}`
          : `net[grade] = stock-counter theoretical (Summary!C) + ${SHORTS_FORMULA} over the horizon`
      ),
    };
  }
}

class WhatIf implements LuaTool {
  name = 'what-if';
  description =
    'Check a hypothetical sale: "can I sell N bags of grade G for month M without going short?" Returns the net before/after, per month cumulative.';
  inputSchema = z.object({
    grade: z.string().describe('POST grade to sell, passed EXACTLY as the trader typed it (the tool does the matching; never strip/add the POST prefix)'),
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
      ...staleField(d),
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
      cite: cite(
        this.name,
        d,
        SRC_POSITION,
        `netAfter = net["${key}"] − ${input.bags} bags; committed months from Forward Sales row "${key}"`
      ),
    };
  }
}

class PriceAnalytics implements LuaTool {
  name = 'price-analytics';
  description =
    'Average price level of the shorts book: SMT-weighted contract differential AND FOB-equivalent differential (USc/lb vs NY KC) — overall or by sold grade, POST grade, client, delivery month, or fixation month; plus the fixed vs price-to-be-fixed split, overall AND per bucket (answers "how much of my grinder book / my deferreds re-rates if NY moves"). No cost basis, P&L, or market prices.';
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
    const { data: d, sales: base } = await snapshotSales(input.positionDate, { client: input.client, month: input.month });
    let sales = base;
    if (input.fixMonth) sales = sales.filter((s) => (s.sFixDte ?? '').toUpperCase() === input.fixMonth!.toUpperCase());
    if (sales.length === 0) return { ...staleField(d), positionDate: d.positionDate, note: 'No sales match that filter.' };

    const blends = input.dimension === 'postGrade' ? await loadBlendRecipes() : undefined;
    const result = computePricing(sales, { dimension: input.dimension, blends });

    let byBucket: Record<string, any> | undefined = result.byBucket;
    let distinctContracts: { contracts: number; fixed: number; ptbf: number } | undefined;
    if (byBucket && input.dimension === 'postGrade') {
      if (input.grade) {
        const target = normGrade(input.grade);
        byBucket = Object.fromEntries(Object.entries(byBucket).filter(([g]) => normGrade(g).includes(target)));
        if (Object.keys(byBucket).length === 0)
          return { ...staleField(d), positionDate: d.positionDate, note: `No POST grade matching "${input.grade}" carries priced shorts.` };
      }
      // dedup: how many actual contracts stand behind the shown buckets
      const priced = sales.filter((s) => s.sDif != null || s.sFobDif != null);
      distinctContracts = distinctContractsForGrades(priced, blends!, Object.keys(byBucket));
      // postGrade buckets are weighted by blend-allocated BAGS, not MT — name the field accordingly
      byBucket = Object.fromEntries(
        Object.entries(byBucket).map(([g, b]: [string, any]) => [
          g,
          {
            contracts: b.contracts,
            allocatedBags: b.smt,
            contractDifUscLb: b.contractDifUscLb,
            fobDifUscLb: b.fobDifUscLb,
            fixed: { contracts: b.fixed.contracts, allocatedBags: b.fixed.smt, flatUscLb: b.fixed.flatUscLb },
            ptbf: { contracts: b.ptbf.contracts, allocatedBags: b.ptbf.smt },
          },
        ])
      );
    }

    return {
      ...staleField(d),
      positionDate: d.positionDate,
      demo: d.demo === true || undefined,
      scope: 'unallocated shorts book only (differentials vs NY KC, USc/lb)',
      overall: result.overall,
      byBucket,
      distinctContracts,
      coverage: result.coverage,
      caveats: [
        'Contract dif is on each sale\'s own Incoterm; FOB dif is the FOB-equivalent — present BOTH, never just one.',
        `Price-to-be-fixed volume: ${result.overall.ptbf.smt} MT across ${result.overall.ptbf.contracts} contracts (differential agreed, futures leg open).`,
        ...(input.dimension === 'postGrade'
          ? [
              'POST-grade figures attribute each contract\'s differential across its blend grades (weighted by allocated bags).',
              'postGrade bucket contract counts OVERLAP (a contract counts in every grade its blend touches) — NEVER sum them across buckets; quote distinctContracts for "how many contracts".',
            ]
          : []),
        ...(result.coverage.unpriced > 0
          ? [`${result.coverage.unpriced} sale(s) carry no differential and are excluded: ${result.coverage.unpricedContracts.join(', ')}`]
          : []),
      ],
      cite: cite(
        this.name,
        d,
        SRC_LOGISTICS,
        'difs = SMT-weighted avg of "S.Dif" (contract) and "S.Fob dif" (FOB-equiv), USc/lb vs NY KC; flat = "S. Price" normalized to USc/lb; fixed ⇔ "S. Price" set'
      ),
    };
  }
}

/** Shared: load snapshot sales with the standard error messages, optionally filtered. */
async function snapshotSales(positionDate?: string, filter?: { client?: string; month?: string; soldGrade?: string }) {
  const snap = await getSnapshot(positionDate);
  if (!snap) throw new Error('No position snapshot exists yet — ingest the exports first.');
  let sales: any[] = snap.data.sales ?? [];
  if (sales.length === 0) throw new Error('This snapshot has no sales — ingest the logistics report first.');
  if (filter?.client) sales = sales.filter((s) => (s.client ?? '').toUpperCase().includes(filter.client!.toUpperCase()));
  if (filter?.month) sales = sales.filter((s) => s.month === filter.month);
  if (filter?.soldGrade) sales = sales.filter((s) => (s.sGrade ?? '').toUpperCase().includes(filter.soldGrade!.toUpperCase()));
  return { data: snap.data, sales };
}

class ClientExposureTool implements LuaTool {
  name = 'client-exposure';
  description =
    'Counterparty exposure of the shorts book: per client — contracts, SMT/bags, share of book, delivery-month ladder, sold grades, destination countries, payment terms, desk trader. For a client\'s price level use price-analytics.';
  inputSchema = z.object({
    positionDate: dateField,
    client: z.string().optional().describe('Filter to clients whose name contains this (case-insensitive)'),
    month: z.string().regex(/^\d{4}\/\d{2}$/).optional().describe('Filter to one delivery month YYYY/MM before ranking'),
    soldGrade: z.string().optional().describe('Filter to sales whose sold grade contains this (e.g. "GRINDER") — SOL sold grades, not POST grades'),
    top: z.number().int().positive().optional().describe('Return only the N largest counterparties'),
  });

  async execute(input: { positionDate?: string; client?: string; month?: string; soldGrade?: string; top?: number }) {
    const { data, sales } = await snapshotSales(input.positionDate, {
      client: input.client,
      month: input.month,
      soldGrade: input.soldGrade,
    });
    if (sales.length === 0)
      return {
        ...staleField(data),
        positionDate: data.positionDate,
        note: `No sales match that filter (client~"${input.client ?? ''}", month=${input.month ?? 'any'}, soldGrade~"${input.soldGrade ?? ''}").`,
      };
    const exposure = computeClientExposure(sales);
    return {
      ...staleField(data),
      positionDate: data.positionDate,
      demo: data.demo === true || undefined,
      scope: 'unallocated shorts book only',
      total: exposure.total,
      clients: input.top ? exposure.clients.slice(0, input.top) : exposure.clients,
      caveats: [
        'Share % is of the filtered set shown, by |SMT|.',
        'Volumes are contract commitments (negative = sold forward), not shipped quantities.',
        ...(input.month || input.soldGrade
          ? ['A month/soldGrade filter is active — totals and shares cover the filtered slice, not the whole book.']
          : []),
      ],
      cite: cite(this.name, data, SRC_LOGISTICS, 'per client: Σ "S.MT" (and bags "S.Bags") over unallocated sales; share % by |SMT| of the shown set'),
    };
  }
}

class ShipmentStatusTool implements LuaTool {
  name = 'shipment-status';
  description =
    'Booking status of the forward book: booked vs unbooked contracts (counts + MT) overall and per delivery month, plus booked-shipment detail (vessel, voyage, booking line/number, POL→POD, ETD/ETA). The export has no B/L, container, invoice, or warehouse data.';
  inputSchema = z.object({
    positionDate: dateField,
    month: z.string().regex(/^\d{4}\/\d{2}$/).optional().describe('Filter to one delivery month YYYY/MM'),
    client: z.string().optional().describe('Filter to clients whose name contains this (case-insensitive)'),
    state: z
      .enum(['unbooked', 'preshipment-only', 'vessel-assigned'])
      .optional()
      .describe('Filter the booked-shipment detail list to one booking state (counts always cover all three)'),
  });

  async execute(input: { positionDate?: string; month?: string; client?: string; state?: string }) {
    const { data, sales } = await snapshotSales(input.positionDate, { client: input.client, month: input.month });
    if (sales.length === 0) return { ...staleField(data), positionDate: data.positionDate, note: 'No sales match that filter.' };
    const status = computeShipmentStatus(sales);
    const shipments =
      input.state === 'unbooked'
        ? []
        : input.state
          ? status.shipments.filter((sh: any) => sh.stage === input.state)
          : status.shipments;
    return {
      ...staleField(data),
      positionDate: data.positionDate,
      demo: data.demo === true || undefined,
      scope: 'unallocated shorts book — booking state of forward sales, not voyage tracking',
      overall: status.overall,
      byMonth: status.byMonth,
      shipments,
      ...(input.state === 'unbooked'
        ? { note: 'Unbooked contracts have no booking detail rows by definition — use overall/byMonth unbooked counts.' }
        : {}),
      caveats: [
        'Three states — unbooked, preshipment-only (booked, no vessel yet: see stage), vessel-assigned. Never call a preshipment-only contract "unbooked".',
        'A split contract can carry several bookings on one sailing (IDs joined with " / ").',
        'ETD/ETA exist only on vessel-assigned bookings; ETA on a subset of those.',
        'Not in this export (do not guess): B/L numbers, containers, invoices/due dates, warehouses, consignees.',
      ],
      cite: cite(this.name, data, SRC_LOGISTICS, 'states from booking columns "PreshipID"/"Vessel"/"ETD"/"ETA" per contract (\'0\' = empty)'),
    };
  }
}

class CertExposureTool implements LuaTool {
  name = 'cert-exposure';
  description =
    'Certification / EUDR exposure, honestly partial: sold-forward volume by cert tag (S.Cert — only ~1/3 of contracts are tagged) and unsold physical stock by cert tag (DNP certification column). Untagged = certification UNKNOWN, never "not certified". EUDR-flagged = any tag containing EUDR.';
  inputSchema = z.object({
    positionDate: dateField,
    tag: z.string().optional().describe('Filter to cert tags containing this (case-insensitive), e.g. "EUDR", "RA"'),
    client: z.string().optional().describe('Filter the SALES side to clients whose name contains this (stock side is not per-client)'),
    month: z.string().regex(/^\d{4}\/\d{2}$/).optional().describe('Filter the SALES side to one delivery month YYYY/MM'),
  });

  async execute(input: { positionDate?: string; tag?: string; client?: string; month?: string }) {
    const { data, sales } = await snapshotSales(input.positionDate, { client: input.client, month: input.month });
    const result = computeCertExposure(sales, data.dnp ?? undefined);
    const filterTags = (byTag: Record<string, any>) =>
      input.tag ? Object.fromEntries(Object.entries(byTag).filter(([t]) => t.toUpperCase().includes(input.tag!.toUpperCase()))) : byTag;
    return {
      ...staleField(data),
      positionDate: data.positionDate,
      demo: data.demo === true || undefined,
      sales: { ...result.sales, byTag: filterTags(result.sales.byTag) },
      stock: result.stock
        ? { ...result.stock, byTag: filterTags(result.stock.byTag) }
        : { note: 'This snapshot\'s DNP predates certification capture — re-ingest the DailyNetPosition export to get the stock side.' },
      caveats: [
        `Coverage is partial by nature: ${result.sales.tagged.contracts}/${result.sales.total.contracts} sales contracts carry a cert tag${
          result.stock ? `; ${result.stock.tagged.rows}/${result.stock.rows} unsold stock rows do (${result.stock.tagged.mt} MT)` : ''
        }. UNTAGGED means certification UNKNOWN — never report untagged volume as non-certified.`,
        'All sharePct figures are of the TOTAL volume (tagged + untagged), not of the tagged subset.',
        'Stock side = unsold purchase rows only (in-store origin / to-be-shipped), purchase MT.',
        'The full cert picture needs the 3 external cert workbooks (not yet provided); these are the tags SOL itself carries.',
        ...(input.client || input.month
          ? ['client/month filters apply to the SALES side only — the stock rollup is always the whole unsold inventory.']
          : []),
      ],
      cite: cite(
        this.name,
        data,
        ['SOL ReportLogistic (sales certs)', 'SOL DailyNetPosition (stock certs)'],
        'sales tags from "S.Cert" (Σ "S.MT"); stock tags from DNP "certification" (Σ "P.MT" on unsold in-store/to-be-shipped rows)'
      ),
    };
  }
}

class StockAnalyticsTool implements LuaTool {
  name = 'stock-analytics';
  description =
    'Physical stock (XBS) by one flat dimension: warehouse (bags + avg intake-age), cropYear, blocked, or cert (XBS tag vocabulary). Blocked / WIP / old-crop stock COUNTS toward the total — these are carve-outs, never exclusions. Cross-dimension splits (e.g. warehouse × crop year) are not available.';
  inputSchema = z.object({
    positionDate: dateField,
    dimension: z.enum(['warehouse', 'cropYear', 'blocked', 'cert']).describe('The one dimension to roll up by'),
  });

  async execute(input: { positionDate?: string; dimension: StockDimension }) {
    const snap = await getSnapshot(input.positionDate);
    if (!snap?.data?.stock) throw new Error('No ingested stock report found — run ingest-stock-report first.');
    const stock = snap.data.stock;
    const result = computeStockAnalytics(input.dimension, { location: stock.location, coverage: stock.coverage });
    const DERIV: Record<StockDimension, string> = {
      warehouse: 'Σ XBS "Qty."(kg)/60 by "Warehouse"; intake age weighted by kg from "Intake Date"',
      cropYear: 'Σ XBS "Qty."(kg)/60 by "Inventory Type" (crop year)',
      blocked: 'Σ XBS "Qty."(kg)/60 split on "Blocked"=Yes/No',
      cert: 'Σ XBS "Qty."(kg)/60 by "Certification" tag (XBS vocabulary)',
    };
    const base = {
      ...staleField(snap.data),
      positionDate: snap.data.positionDate,
      demo: snap.data.demo === true || undefined,
      dimension: input.dimension,
      cite: cite(this.name, snap.data, ['XBS Current Stock'], DERIV[input.dimension]),
    };
    if (!result)
      return {
        ...base,
        note: `This snapshot's stock report predates ${input.dimension} capture — re-ingest the XBS export (ingest-stock-report) to enable it. Do not estimate.`,
      };

    const rDim = (b: { rows: number; bags: number; sharePct: number }) => ({ rows: b.rows, bags: round(b.bags), sharePct: round(b.sharePct) });
    const commonCaveat = 'Physical XBS stock only (bag-equivalents = kg/60) — not the net position, not sold/unsold state.';
    const totals = { rows: result.totals.rows, bags: round(result.totals.bags) };

    switch (input.dimension) {
      case 'warehouse':
        return {
          ...base,
          totals,
          warehouses: result.warehouses!.map((w) => ({
            location: w.location,
            originalName: w.originalName,
            bags: round(w.bags),
            avgIntakeAgeDays: round(w.avgDays),
            sharePct: round(w.sharePct),
          })),
          caveats: [
            commonCaveat,
            '"No Warehouse Assigned" = work-in-progress lots — they COUNT toward the total; never subtract them.',
            'avgIntakeAgeDays is intake-age weighted by kg; lots without a parseable intake date dilute the average.',
          ],
        };
      case 'cropYear':
        return {
          ...base,
          totals,
          byCropYear: Object.fromEntries(Object.entries(result.byCropYear!).map(([y, b]) => [y, rDim(b)])),
          caveats: [
            commonCaveat,
            'Old-crop stock COUNTS toward the total — report it as a carve-out, never subtract it silently.',
          ],
        };
      case 'blocked':
        return {
          ...base,
          totals,
          blocked: rDim(result.blocked!),
          notBlocked: { rows: result.notBlocked!.rows, bags: round(result.notBlocked!.bags) },
          caveats: [
            commonCaveat,
            'Blocked stock COUNTS toward the total position — it is a carve-out ("of which blocked"), NOT an exclusion. Never report the total net of blocked.',
            'sharePct is of the TOTAL stock.',
          ],
        };
      case 'cert':
        return {
          ...base,
          totals,
          tagged: rDim(result.tagged!),
          untagged: { rows: result.untagged!.rows, bags: round(result.untagged!.bags) },
          byTag: Object.fromEntries(Object.entries(result.byTag!).map(([t, b]) => [t, rDim(b)])),
          caveats: [
            commonCaveat,
            'UNTAGGED = certification UNKNOWN, never "not certified" — tagged figures are floors ("at least X").',
            'These are XBS certification tags ("RAINFOREST ALLIANCE", "FAIRTRADE"…) — a DIFFERENT vocabulary from the SOL tags in cert-exposure ("RA", "RFA", "4C.RFA"). Do NOT merge or reconcile the two cert sources; the mapping is unconfirmed.',
            'All sharePct figures are of the TOTAL stock (tagged + untagged), not of the tagged subset.',
          ],
        };
    }
  }
}

class ExplainFigure implements LuaTool {
  name = 'explain-figure';
  description =
    'Trace a shorts/net figure to its exact source rows: the sales contracts feeding one POST grade (or offer), each with contract number, client, S.MT, blend fraction, and allocated bags — the total ties to the quoted figure. Use when the trader asks "where does that number come from / which contracts are behind it".';
  inputSchema = z.object({
    positionDate: dateField,
    grade: z.string().describe('POST grade or offer name whose figure to explain, passed EXACTLY as the trader typed it (the tool does the matching; never strip/add the POST prefix)'),
    month: z.string().regex(/^\d{4}\/\d{2}$/).optional().describe('Narrow to one delivery month YYYY/MM (traces that exact matrix cell)'),
  });

  async execute(input: { positionDate?: string; grade?: string; month?: string }) {
    const { data, sales } = await snapshotSales(input.positionDate);
    const blends = await loadBlendRecipes();
    const target = normGrade(input.grade ?? '');
    const gradeKey =
      POST_GRADES_SUMMARY.find((g) => normGrade(g) === target) ??
      POST_GRADES_SUMMARY.find((g) => normGrade(g).includes(target));
    const members: Array<[string, number]> = gradeKey
      ? [[gradeKey, 1]]
      : (resolveOfferQuery(input.grade ?? '')?.members ?? []);
    if (members.length === 0)
      return {
        ...staleField(data),
        positionDate: data.positionDate,
        error: `No grade or offer matching "${input.grade}". Grades: ${POST_GRADES_SUMMARY.join(', ')}. Offers: TOP, PLUS, AA FAQ, AB FAQ, ABC FAQ, GRINDER 14+, GRINDER 13-.`,
      };

    const perGrade = members.map(([grade, weight]) => {
      const ex = explainGradeContributions(sales, blends, grade, input.month);
      return { grade, weight, totalBags: ex.totalBags, weightedBags: round(ex.totalBags * weight), contracts: ex.rows };
    });
    return {
      ...staleField(data),
      positionDate: data.positionDate,
      demo: data.demo === true || undefined,
      figure: { grade: input.grade, resolved: members.map(([g, w]) => `${g} ×${w}`).join(' + '), month: input.month ?? 'all months' },
      totalBags: round(perGrade.reduce((s, g) => s + g.weightedBags, 0)),
      perGrade,
      caveats: [
        'allocatedBags = "S.MT" × blend fraction × 1000/60 — the exact allocation the shorts matrix uses; the total ties to the quoted cell.',
        'Shorts side only. Longs (theoretical stock) drill down to XBS rows, which are summarized at ingest — re-open the XBS export itself for lot-level detail.',
        ...((data.pendingBlends ?? []).length ? [`${data.pendingBlends.length} sale(s) pending blend confirmation are NOT in any grade figure.`] : []),
      ],
      cite: cite(this.name, data, SRC_LOGISTICS, `each row: "Sale Ctr.", client, "S.MT", blend fraction → allocated bags (${SHORTS_FORMULA})`),
    };
  }
}

export const querySkill = new LuaSkill({
  name: 'position-query',
  description: 'Answer position questions and what-ifs from the computed snapshots.',
  context: `Answering questions about the position.
- query-position for "what's my net position", "how short am I on AB FAQ", "shorts by month for grinders". Always mention the position date and any pending blend confirmations. Filters: grade alone → that grade's block incl. its shorts-by-month row; month alone → shorts by grade for that delivery month; both → the single grade-month cell; neither → full position incl. a shortsByMonth total ladder. grade also accepts OFFER names (TOP, PLUS, AA FAQ, AB FAQ, ABC FAQ, GRINDER 14+, GRINDER 13-) and returns the weighted roll-up with its member grades — say it's a roll-up, not a single grade. Months outside the netting horizon show in shortsByMonth but are NOT in net figures — the result's notes name exactly which months those are; relay them verbatim, never guess or extend the list. Full-position results carry \`insights\` — code-computed observations; relay the ones that matter, numbers verbatim.
- what-if for "can I sell N bags of X for month M" — report netAfter and, if it goes short, the first month it happens. Never turn this into trade advice; state the numbers.
- price-analytics for "at what price level am I short", "average differential on grinders", "how much is fixed vs to-be-fixed". "Price level" on this desk = differential vs the NY KC futures in USc/lb. ALWAYS present the contract differential and the FOB-equivalent side by side — neither is the headline. State the fixed vs price-to-be-fixed split and any excluded (unpriced) sales. Every bucket carries its own fixed/ptbf split — for "how much of my grinder book / August book re-rates if NY moves", quote that bucket's ptbf volume and share (price-to-be-fixed = futures leg open = re-rates with NY; fixed volume does not). It covers the unallocated shorts book only: no purchase cost basis, no P&L or mark-to-market (no market prices exist in the data), no price history — say so when asked.
- client-exposure for "who am I most short to", "my exposure to Nestle", "what does client X buy". "Exposure to X" is a client question ONLY when X is a counterparty name; when X looks like a grade/offer or is unrecognized, try query-position first — its miss reply lists the valid grades and offers. Volumes are forward commitments by counterparty; combine with price-analytics (dimension=client) when they also want the price level. Filters: client, month (one delivery month), soldGrade ("who buys grinders") — when filtered, say the ranking covers that slice only.
- shipment-status for "what's booked/unbooked", "what's shipping this month", "when does X's coffee leave". Three states, keep them distinct: unbooked / preshipment-only (booked, no vessel yet) / vessel-assigned — a contract with a preshipment but no vessel is BOOKED. Filters: month, client, state (narrows the shipment detail list to one booking state). The export has no B/L, container, invoice, due-date, or warehouse data, so decline those plainly instead of approximating.
- cert-exposure for "how much of my book is EUDR", "certified stock", "what's sold as Rainforest Alliance". ALWAYS lead with the coverage caveat: only a minority of contracts/lots carry a cert tag, so figures are floors ("at least X"), and UNTAGGED volume is UNKNOWN — never "not certified". EUDR-flagged = tag contains EUDR (RA.EUDR, CP.EUDR, AAA.EUDR…). Filters: tag, client, month — client/month narrow the SALES side only; the stock rollup stays whole-inventory.
- price-analytics postGrade answers: bucket contract counts overlap across grades (a contract counts in every grade its blend touches) — NEVER sum bucket counts; quote the result's distinctContracts for "how many contracts".
- stock-analytics for "stock by warehouse", "how old is the stock", "how much is blocked", "old-crop stock", "certified physical stock" — one flat dimension per call (warehouse | cropYear | blocked | cert). Blocked, WIP (no warehouse) and old-crop stock all COUNT toward the total: quote the full total and the carve-out ("35,568 bags, of which 339 blocked"), NEVER a total net of them. Its cert tags are XBS vocabulary — a different tag set from cert-exposure's SOL tags; never merge the two. Cross-dimension splits (warehouse × crop year) are not available — say so.
- Every result carries a \`cite\` line (tool · snapshot · sources · ingested · derivation) — end the answer with it verbatim, prefixed "— ". Numbers not present in a tool result must never be stated.
- explain-figure for "where does that number come from", "which contracts are behind the 16 FAQ shorts", "break that −960 down" — it lists the exact contracts (Sale Ctr., client, S.MT, blend fraction, allocated bags) whose sum ties to the quoted figure. Shorts side only; XBS lot-level detail isn't stored — say so.
- Grades are matched fuzzily ("16 FAQ" → POST 16 FAQ). When a result carries \`resolvedFrom\`, open the grade block by confirming the match ("16 faq" → POST 16 FAQ). When it doesn't, the trader's name matched exactly — never claim fuzzy matching or invent how the name was resolved.
- Quote bags by default; add MT when the trader asks or the number is hedge-related.
- Never label net values as "longs": longs = theoretical stock, net = longs + shorts. Say which one you're quoting.`,
  tools: [new QueryPosition(), new WhatIf(), new PriceAnalytics(), new ClientExposureTool(), new ShipmentStatusTool(), new CertExposureTool(), new StockAnalyticsTool(), new ExplainFigure()],
});
