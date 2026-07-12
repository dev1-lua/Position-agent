import { LuaSkill, LuaTool } from 'lua-cli';
import { z } from 'zod';
import { citeLine } from '../lib/cite';
import { computeNetPosition, computeOffers } from '../lib/netposition';
import { sumOverMonths } from '../lib/shorts';
import { computeFutsSpread, futuresPotBySFixDte, FutsManualInputs } from '../lib/futsspread';
import { round } from '../lib/units';
import { COLLECTIONS, getSnapshot, saveSnapshot, upsert, getAll } from './store';
import { runComputeChain, defaultHorizon } from './pipeline';

/**
 * Assembly: net position (longs + shorts over the horizon), offer roll-ups,
 * and the Futs+Spread hedge view (which needs the trader's manual pot/cert
 * inputs until those sources are wired).
 */

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Defaults to the latest snapshot');

// Netting-horizon rationale lives with defaultHorizon in ./pipeline (rolling
// window anchored on the position date: month −6 through +3, ten months).

class ComputePosition implements LuaTool {
  name = 'compute-position';
  description =
    'Run the ENTIRE compute chain in one call: blend assignment (flagging ambiguous sales) → forward-sales matrix → net position + offers → futs/hedge (when the DNP is on file). Use this for "compute my position" — never chain the individual compute tools for that.';
  inputSchema = z.object({ positionDate: dateField });

  async execute(input: { positionDate?: string }) {
    return runComputeChain(input.positionDate, { tool: this.name });
  }
}

class ComputeNetPosition implements LuaTool {
  name = 'compute-net-position';
  description =
    'Net position by POST grade = theoretical stock + forward sales over the horizon (workbook rule: 10 months, skipping the oldest). Also computes the offer roll-ups.';
  inputSchema = z.object({
    positionDate: dateField,
    horizonMonths: z.array(z.string().regex(/^\d{4}\/\d{2}$/)).optional()
      .describe('Explicit YYYY/MM months to net over (overrides the workbook rule)'),
  });

  async execute(input: { positionDate?: string; horizonMonths?: string[] }) {
    const snap = await getSnapshot(input.positionDate);
    if (!snap?.data?.theoretical?.byGrade) throw new Error('Theoretical stock missing — run compute-theoretical-stock first.');
    if (!snap?.data?.forwardSales?.matrix) throw new Error('Forward sales missing — run compute-forward-sales first.');

    const horizon = input.horizonMonths ?? defaultHorizon(snap.data.positionDate);
    const fwdByGrade = sumOverMonths(snap.data.forwardSales.matrix, horizon);
    const net = computeNetPosition(snap.data.theoretical.byGrade, fwdByGrade);
    const offers = computeOffers(net);

    await saveSnapshot(snap.data.positionDate, { net: { horizon, byGrade: net.byGrade, total: net.total }, offers });

    return {
      positionDate: snap.data.positionDate,
      horizon,
      netTotalBags: round(net.total.net),
      byGrade: Object.fromEntries(
        Object.entries(net.byGrade)
          .filter(([, v]) => v.theoretical !== 0 || v.forwardSales !== 0)
          .map(([g, v]) => [g, { longs: round(v.theoretical), shorts: round(v.forwardSales), net: round(v.net) }])
      ),
      offers,
      pendingBlendCount: snap.data.forwardSales.pendingCount ?? 0,
      cite: citeLine({
        tool: this.name,
        positionDate: snap.data.positionDate,
        demo: snap.data.demo === true,
        updatedAt: snap.data.updatedAt,
        sources: ['XBS Current Stock (longs)', 'SOL ReportLogistic (shorts)'],
      }),
    };
  }
}

class SetManualInputs implements LuaTool {
  name = 'set-manual-inputs';
  description =
    'Record the manual daily figures the hedge view needs: futures pots (Kenyacof, KenyaZZ, Δ Hedge KENY_AR_DYN), not-in-stock contract MT, specialty adjustment, and certificate positions.';
  inputSchema = z.object({
    positionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Position date these figures belong to'),
    kenyacofFutsMt: z.number().optional().describe('Kenyacof pot total futures MT (SOL "Kenyacof26" bottom row)'),
    kenyaZzMt: z.number().optional().describe('KenyaZZ pot MT'),
    deltaHedgeKenyArDynMt: z.number().optional().describe('Δ Hedge from the KENY_AR_DYN pot, MT'),
    contractedNotInStockNoHedgeMt: z.number().optional(),
    contractedNotInStockHedgedMt: z.number().optional(),
    notContractedNotInStockMt: z.number().optional(),
    expectedSpecialtyAdjustMt: z.number().optional(),
    certificates: z.record(z.string(), z.number()).optional()
      .describe('Certificate positions, e.g. {"AAA": 120, "RFA": 80} — from the cert workbooks'),
  });

  async execute(input: { positionDate: string } & FutsManualInputs) {
    const { positionDate, ...manual } = input;
    const defined = Object.fromEntries(Object.entries(manual).filter(([, v]) => v !== undefined));
    await upsert(COLLECTIONS.manualInputs, { positionDate }, { positionDate, ...defined });
    return { positionDate, stored: Object.keys(defined), note: 'Re-run compute-futs-spread to apply.' };
  }
}

class ComputeFutsSpread implements LuaTool {
  name = 'compute-futs-spread';
  description =
    'Hedge view (MT + 17.01-MT lots): stock, direct-sales stock, non-hedgeable, specialty, Kenyacof/Sucafina futures, net specialty — plus the futures pot pivot by fixing month.';
  inputSchema = z.object({ positionDate: dateField });

  async execute(input: { positionDate?: string }) {
    const snap = await getSnapshot(input.positionDate);
    const d = snap?.data;
    if (!d?.theoretical?.byGrade) throw new Error('Theoretical stock missing — run compute-theoretical-stock first.');
    if (!d?.dnp) throw new Error('DailyNetPosition missing — run ingest-daily-net-position first.');
    if (!d?.forwardSales?.matrix) throw new Error('Forward sales missing — run compute-forward-sales first.');

    const manualRows = await getAll(COLLECTIONS.manualInputs, { positionDate: d.positionDate });
    const manual: FutsManualInputs = manualRows[0]?.data ?? {};

    const months: string[] = [...(d.forwardSales.months ?? [])].sort();
    const reportMonths = months.slice(1); // Summary E:P — all but the oldest
    const natRow = d.forwardSales.matrix['POST NATURAL'] ?? {};
    const postNaturalForwardBags = reportMonths.reduce((s, mo) => s + (natRow[mo] || 0), 0);
    const byGrade = d.theoretical.byGrade as Record<string, number>;

    const futs = computeFutsSpread({
      theoreticalTotalBags: d.theoretical.totals.total,
      postNaturalBags: byGrade['POST NATURAL'] || 0,
      rejectsSBags: byGrade['POST REJECTS S'] || 0,
      rejectsPBags: byGrade['POST REJECTS P'] || 0,
      postNaturalForwardBags,
      dnp: d.dnp,
      manual,
    });
    const pots = futuresPotBySFixDte(d.sales ?? []);

    await saveSnapshot(d.positionDate, { futs: { lines: futs.lines, order: futs.order, certificates: futs.certificates, pots } });

    const missingManual = ['kenyacofFutsMt', 'deltaHedgeKenyArDynMt'].filter((k) => (manual as any)[k] === undefined);
    return {
      positionDate: d.positionDate,
      lines: Object.fromEntries(
        futs.order.map((k) => [k, { mt: futs.lines[k].mt != null ? round(futs.lines[k].mt!) : null, lots: futs.lines[k].lots != null ? round(futs.lines[k].lots!) : null }])
      ),
      futuresPots: Object.fromEntries(Object.entries(pots.byPot).map(([k, v]) => [k, round(v)])),
      futuresPotTotalMt: round(pots.totalMt),
      certificates: futs.certificates,
      caveat: missingManual.length
        ? `Manual inputs not set for this date (${missingManual.join(', ')}) — those lines assume 0. Use set-manual-inputs.`
        : 'Includes trader-provided manual pot figures.',
      cite: citeLine({
        tool: this.name,
        positionDate: d.positionDate,
        demo: d.demo === true,
        updatedAt: d.updatedAt,
        sources: ['SOL DailyNetPosition (hedge rows)', 'SOL ReportLogistic (pots)', 'trader manual inputs'],
      }),
    };
  }
}

export const positionSkill = new LuaSkill({
  name: 'position-net',
  description: 'Assemble the position: net by grade (longs + shorts over the horizon), offer roll-ups, and the Futs+Spread hedge view.',
  context: `Assembly step, after the exports are ingested.
- compute-position is THE tool for "compute my position" / "run the numbers": ONE call runs blend assignment → forward sales → net + offers → hedge. NEVER chain the individual compute tools for a full run — make the single call and answer only from its result. If it returns pendingConfirmation sales, relay them and ask the trader for blend numbers (confirm-blend), then re-run compute-position. The result carries \`shortsByMonth\` (month → total short bags — show it as the "Shorts by month" table) and \`insights\` (code-computed observations; relay the relevant ones, numbers verbatim).
- compute-net-position / compute-futs-spread are for targeted re-runs only (e.g. custom horizonMonths, or refreshing the hedge after set-manual-inputs).
- compute-futs-spread needs the trader's manual pot figures (set-manual-inputs) — always state the caveat when they're missing or stale.
- Certificate positions are manual passthrough until the cert workbooks are wired; say so when asked about certs.`,
  tools: [new ComputePosition(), new ComputeNetPosition(), new SetManualInputs(), new ComputeFutsSpread()],
});
