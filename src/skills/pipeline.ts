import { Sale, StockRow } from '../lib/types';
import { matchBlend, globallyAmbiguousKeys, assignmentKey } from '../lib/blends';
import { computeForwardSales, sumOverMonths } from '../lib/shorts';
import { computeNetPosition, computeOffers } from '../lib/netposition';
import { computeFutsSpread, futuresPotBySFixDte, FutsManualInputs } from '../lib/futsspread';
import {
  calculateTheoreticalStock,
  derivePercentagesFromGroups,
  theoreticalByGrade,
  Percentages,
} from '../lib/stockcounter';
import { round } from '../lib/units';
import { citeLine } from '../lib/cite';
import {
  COLLECTIONS,
  getSnapshot,
  saveSnapshot,
  upsert,
  getAll,
  loadBlendRecipes,
  loadAssignmentMemory,
  loadAssumptions,
  loadStrategyMapping,
  loadForecastOverrides,
} from './store';

/**
 * The full compute chain (assign blends → forward sales → net + offers →
 * futs/hedge) as ONE in-process run.
 *
 * Why this exists: when the model chains the four tools itself it streams
 * transitional narration between the calls ("Running the pipeline now…
 * Continuing.") — banned, but structurally invited by the gaps. One tool
 * call = no gaps = nothing to narrate (prod leak, 2026-07-10). The granular
 * tools remain for step-by-step use.
 */

/** Workbook horizon rule: 10 months, starting 6 months back (Summary E:N). */
export function defaultHorizon(positionDate: string, count = 10, backMonths = 6): string[] {
  let [y, m] = positionDate.slice(0, 7).split('-').map(Number);
  m -= backMonths;
  while (m < 1) { m += 12; y--; }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}/${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export async function runComputeChain(positionDate?: string, opts: { tool: string } = { tool: 'compute-position' }) {
  const snap = await getSnapshot(positionDate);
  if (!snap) throw new Error('No position snapshot exists yet — ingest the exports first.');
  const d = snap.data;
  if (!d.sales?.length) throw new Error('This snapshot has no sales — ingest the logistics report first.');
  if (!d.theoretical?.byGrade && !d.stock)
    throw new Error('No XBS stock report ingested for this date — the longs side is missing.');

  // 0. theoretical stock (longs) — computed here when the XBS report is
  //    ingested but the counter hasn't run yet (same logic as
  //    compute-theoretical-stock, folded in so ONE call covers the chain)
  let unresolvedRows: Array<{ rowKey: string; detail: string }> = [];
  if (!d.theoretical?.byGrade) {
    const { status, matrix, postBags, groups } = d.stock;
    const derived = derivePercentagesFromGroups(groups ?? [], {
      assumptions: await loadAssumptions(),
      strategyMapping: await loadStrategyMapping(),
    });
    const overrides = await loadForecastOverrides();
    const percentages: Percentages = { ...derived.percentages };
    for (const [rowKey, pcts] of Object.entries(overrides)) {
      percentages[rowKey] = { ...(percentages[rowKey] ?? {}), ...pcts };
    }
    const covered = new Set(Object.keys(percentages));
    unresolvedRows = derived.unresolved.filter((u) =>
      u.reason !== 'ambiguous-outputs' ? !covered.has(u.rowKey) : !overrides[u.rowKey]
    );
    const postRows: StockRow[] = Object.entries(postBags ?? {}).map(([strategy, kgs]) => ({ strategy, qty: Number(kgs) }));
    const theoretical = calculateTheoreticalStock(postRows, matrix, status, percentages);
    d.theoretical = {
      grades: theoretical.grades,
      order: theoretical.order,
      grandTotalFinished: theoretical.grandTotalFinished,
      unclassifiedBags: theoretical.unclassifiedBags,
      totals: theoretical.totals,
      byGrade: theoreticalByGrade(theoretical),
    };
    await saveSnapshot(d.positionDate, {
      theoretical: d.theoretical,
      percentagesUsed: percentages,
      unresolvedForecastRows: unresolvedRows,
    });
  }

  // 1. blend assignment (learned memory; ambiguous/new keys flagged, never guessed)
  const blends = await loadBlendRecipes();
  const memory = await loadAssignmentMemory();
  const ambiguousKeys = globallyAmbiguousKeys(memory);
  const assigned: Sale[] = [];
  const pending: Array<Record<string, any>> = [];
  for (const sale of d.sales as Sale[]) {
    const m = matchBlend(sale, blends, { useAssigned: true, memory, ambiguousKeys });
    if (!m.needsConfirmation && m.blend) {
      assigned.push({ ...sale, blendNo: m.blend.blendNo });
    } else {
      assigned.push({ ...sale, blendNo: sale.blendNo ?? null });
      const seen = memory[assignmentKey(sale)];
      pending.push({
        positionDate: d.positionDate,
        saleCtr: sale.saleCtr,
        client: sale.client,
        sGrade: sale.sGrade,
        sStrategy: sale.sStrategy,
        smt: sale.smt,
        month: sale.month,
        reason: m.reason,
        candidates: seen ? Object.keys(seen).map(Number) : [],
      });
    }
  }
  for (const p of pending) {
    await upsert(COLLECTIONS.pendingBlends, { positionDate: p.positionDate, saleCtr: p.saleCtr }, p, `pending blend ${p.saleCtr} ${p.client}`);
  }

  // 2. forward-sales matrix (pending sales excluded until confirmed)
  const fs = computeForwardSales(assigned, blends, { useAssigned: true, memory, ambiguousKeys });

  // 3. net position + offers over the workbook horizon
  const horizon = defaultHorizon(d.positionDate);
  const net = computeNetPosition(d.theoretical.byGrade, sumOverMonths(fs.matrix, horizon));
  const offers = computeOffers(net);

  // 4. futs/hedge view — only when the DNP export is on file
  let futsOut: Record<string, any> | undefined;
  let futsSkipped: string | undefined;
  let missingManual: string[] = [];
  if (d.dnp) {
    const manualRows = await getAll(COLLECTIONS.manualInputs, { positionDate: d.positionDate });
    const manual: FutsManualInputs = manualRows[0]?.data ?? {};
    const months = [...fs.months].sort();
    const reportMonths = months.slice(1);
    const natRow = fs.matrix['POST NATURAL'] ?? {};
    const byGrade = d.theoretical.byGrade as Record<string, number>;
    const futs = computeFutsSpread({
      theoreticalTotalBags: d.theoretical.totals.total,
      postNaturalBags: byGrade['POST NATURAL'] || 0,
      rejectsSBags: byGrade['POST REJECTS S'] || 0,
      rejectsPBags: byGrade['POST REJECTS P'] || 0,
      postNaturalForwardBags: reportMonths.reduce((s, mo) => s + (natRow[mo] || 0), 0),
      dnp: d.dnp,
      manual,
    });
    const pots = futuresPotBySFixDte(assigned);
    futsOut = { lines: futs.lines, order: futs.order, certificates: futs.certificates, pots };
    missingManual = ['kenyacofFutsMt', 'deltaHedgeKenyArDynMt'].filter((k) => (manual as any)[k] === undefined);
  } else {
    futsSkipped = 'DailyNetPosition not ingested for this date — hedge view skipped.';
  }

  // one snapshot write with every result
  await saveSnapshot(d.positionDate, {
    sales: assigned,
    pendingBlends: pending,
    forwardSales: { matrix: fs.matrix, byGrade: fs.byGrade, months: fs.months, pendingCount: pending.length },
    net: { horizon, byGrade: net.byGrade, total: net.total },
    offers,
    ...(futsOut ? { futs: futsOut } : {}),
  });

  return {
    positionDate: d.positionDate,
    blendAssignment: {
      autoAssigned: assigned.filter((s) => s.blendNo != null).length,
      pendingConfirmation: pending.map((p) => ({
        saleCtr: p.saleCtr,
        client: p.client,
        grade: p.sGrade,
        smt: p.smt,
        month: p.month,
        why: p.reason,
        candidateBlends: p.candidates,
      })),
    },
    horizon,
    total: {
      longsBags: round(net.total.theoretical),
      shortsBags: round(net.total.forwardSales),
      netBags: round(net.total.net),
      netMt: round(net.total.net * 0.06),
    },
    byGrade: Object.fromEntries(
      Object.entries(net.byGrade)
        .filter(([, v]) => v.theoretical !== 0 || v.forwardSales !== 0)
        .map(([g, v]) => [g, { longs: round(v.theoretical), shorts: round(v.forwardSales), net: round(v.net) }])
    ),
    offers,
    hedge: futsOut
      ? Object.fromEntries(
          (futsOut.order as string[]).map((k) => [
            k,
            {
              mt: futsOut!.lines[k].mt != null ? round(futsOut!.lines[k].mt) : null,
              lots: futsOut!.lines[k].lots != null ? round(futsOut!.lines[k].lots) : null,
            },
          ])
        )
      : undefined,
    caveats: [
      ...(pending.length
        ? [`${pending.length} sale(s) need a blend confirmation and are EXCLUDED from every figure until confirmed — ask the trader (confirm-blend), then re-run.`]
        : []),
      ...(unresolvedRows.length
        ? [`${unresolvedRows.length} PRE/IN stock row(s) lack yield percentages — the longs total EXCLUDES their expected output until the trader sets them (set-forecast-percentages).`]
        : []),
      ...(futsSkipped ? [futsSkipped] : []),
      ...(missingManual.length ? [`Manual pot inputs not set (${missingManual.join(', ')}) — those hedge lines assume 0.`] : []),
    ],
    ...(unresolvedRows.length ? { unresolvedForecastRows: unresolvedRows.map((u) => ({ row: u.rowKey, why: u.detail })) } : {}),
    cite: citeLine({
      tool: opts.tool,
      positionDate: d.positionDate,
      demo: d.demo === true,
      updatedAt: new Date().toISOString(),
      sources: d.dnp
        ? ['XBS Current Stock (longs)', 'SOL ReportLogistic (shorts)', 'SOL DailyNetPosition (hedge)']
        : ['XBS Current Stock (longs)', 'SOL ReportLogistic (shorts)'],
      derivation: 'net[grade] = stock-counter theoretical (Summary!C) + Σ "S.MT" × blend fraction × 1000/60 over the horizon',
    }),
  };
}
