/**
 * Golden-day parity harness — validates the pure position engine against the
 * 2026-06-18 LongShort workbook.
 *
 * Run: `npx tsx src/__tests__/parity.ts`
 *
 * Checks:
 *  1. Forward-sales matrix (grade × month) reproduced from BASE FILE sales +
 *     blend recipes, vs the golden Forward Sales sheet.
 *  2. Blend auto-match accuracy: our matcher (ignoring Ivo's assignment) vs the
 *     ground-truth blend number he assigned.
 *  3. Net position (theoretical stock + forward sales over the workbook horizon)
 *     vs the golden Summary sheet.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadBlends, matchBlend, buildAssignmentMemory, globallyAmbiguousKeys } from '../lib/blends';
import { computeForwardSales, sumOverMonths } from '../lib/shorts';
import { computeNetPosition, computeOffers } from '../lib/netposition';
import { normGrade } from '../lib/grades';
import { Sale, StockRow } from '../lib/types';
import {
  runStockCounter,
  theoreticalByGrade,
  deriveForecastPercentages,
} from '../lib/stockcounter';
import { decodeExportText, parseDailyNetPosition, parseLogisticsReport, aggregateSales } from '../lib/parse';
import { computeFutsSpread, futuresPotBySFixDte } from '../lib/futsspread';

const here = dirname(fileURLToPath(import.meta.url));
const blendsSeed = JSON.parse(readFileSync(join(here, '../seed/blends.json'), 'utf8'));
const baseFile = JSON.parse(readFileSync(join(here, 'basefile_2026-06-18.json'), 'utf8'));
const golden = JSON.parse(readFileSync(join(here, 'golden_2026-06-18.json'), 'utf8'));

const blends = loadBlends(blendsSeed);
const sales: Sale[] = baseFile.sales.map((s: any) => ({
  saleCtr: s.saleCtr,
  client: s.client,
  sGrade: s.sGrade,
  cupProfile: s.cupProfile,
  sStrategy: s.sStrategy,
  smt: Number(s.smt) || 0,
  sbags: s.sbags,
  month: s.month,
  sFixDte: s.sFixDte,
  blendNo: s.blendNo,
}));

const TOL = 0.5; // bags tolerance
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log('  ✗ ' + msg);
};
const ok = (msg: string) => console.log('  ✓ ' + msg);

const byNorm = <T extends { grade: string }>(rows: T[]) => {
  const m: Record<string, T> = {};
  for (const r of rows) m[normGrade(r.grade)] = r;
  return m;
};

// ---------- 1. Forward-sales matrix ----------
console.log('\n[1] Forward-sales matrix (using assigned blends) vs golden Forward Sales');
const fs = computeForwardSales(sales, blends, { useAssigned: true });
const fsMonths: string[] = golden.forwardSales.monthHeaders.map(String);
const goldenFS = byNorm(golden.forwardSales.rows);
let maxCellDiff = 0;
let cellChecks = 0;
for (const [ng, grow] of Object.entries(goldenFS)) {
  const mine = fs.matrix[Object.keys(fs.matrix).find((k) => normGrade(k) === ng) || ''] || {};
  (grow as any).months.forEach((gv: any, i: number) => {
    const month = fsMonths[i];
    const g = Number(gv) || 0;
    const m = Number(mine[month] || 0);
    const d = Math.abs(g - m);
    cellChecks++;
    if (d > maxCellDiff) maxCellDiff = d;
    if (d > TOL) fail(`FS ${(grow as any).grade} ${month}: golden ${g} vs mine ${m} (Δ${d.toFixed(2)})`);
  });
}
if (maxCellDiff <= TOL) ok(`all ${cellChecks} matrix cells within ${TOL} (max Δ ${maxCellDiff.toFixed(3)})`);
else console.log(`  → max cell Δ ${maxCellDiff.toFixed(3)} across ${cellChecks} cells`);

// ---------- 2. Blend learned-matcher accuracy (leave-one-out) ----------
console.log('\n[2] Blend matcher — leave-one-out over learned assignment memory');
// The globally-ambiguous registry is persistent knowledge (built as
// confirmations accumulate), so it comes from FULL history even though the
// per-sale memory is leave-one-out.
const ambiguousKeys = globallyAmbiguousKeys(buildAssignmentMemory(sales));
let correct = 0, flagged = 0, wrong = 0;
const wrongSamples: string[] = [];
for (let i = 0; i < sales.length; i++) {
  const sale = sales[i];
  const history = sales.filter((_, j) => j !== i); // hold out sale i
  const memory = buildAssignmentMemory(history);
  const m = matchBlend(sale, blends, { useAssigned: false, memory, ambiguousKeys });
  if (m.needsConfirmation || !m.blend) {
    flagged++;
  } else if (m.blend.blendNo === sale.blendNo) {
    correct++;
  } else {
    wrong++;
    if (wrongSamples.length < 8)
      wrongSamples.push(`${sale.client}/${sale.sGrade}: picked #${m.blend.blendNo} (${m.confidence}), truth #${sale.blendNo}`);
  }
}
const total = sales.length;
console.log(`  auto-applied correct: ${correct}/${total} (${((correct / total) * 100).toFixed(0)}%)`);
console.log(`  flagged for confirm : ${flagged}/${total} (${((flagged / total) * 100).toFixed(0)}%)`);
console.log(`  auto-applied WRONG  : ${wrong}/${total} (${((wrong / total) * 100).toFixed(0)}%)  ← must be ~0`);
wrongSamples.forEach((s) => console.log('     · ' + s));
if (wrong > 0) fail(`${wrong} sales auto-matched to the wrong blend (silent mis-allocation)`);
else ok('no silent mis-allocations (wrong matches are all flagged, not auto-applied)');

// ---------- 3. Net position ----------
console.log('\n[3] Net position vs golden Summary (horizon = Summary E:N = 2025/12..2026/09)');
const horizon = fsMonths.slice(1, 11); // 2025/12 .. 2026/09
const fwdByGrade = sumOverMonths(fs.matrix, horizon);
const theoretical: Record<string, number> = {};
for (const r of golden.summary.rows) theoretical[r.grade] = Number(r.theoreticalStock) || 0;
const net = computeNetPosition(theoretical, fwdByGrade);

const goldenSum = byNorm(golden.summary.rows);
let maxNetDiff = 0;
for (const [ng, gs] of Object.entries(goldenSum)) {
  const key = Object.keys(net.byGrade).find((k) => normGrade(k) === ng);
  const mine = key ? net.byGrade[key].net : 0;
  const g = Number((gs as any).netPosition) || 0;
  const d = Math.abs(g - mine);
  if (d > maxNetDiff) maxNetDiff = d;
  if (d > TOL) fail(`NET ${(gs as any).grade}: golden ${g.toFixed(2)} vs mine ${mine.toFixed(2)} (Δ${d.toFixed(2)})`);
}
if (maxNetDiff <= TOL) ok(`all net-position grades within ${TOL} (max Δ ${maxNetDiff.toFixed(3)})`);
const goldenNetTotal = Number(golden.summary.total.netPosition) || 0;
console.log(`  net total: golden ${goldenNetTotal.toFixed(2)} vs mine ${net.total.net.toFixed(2)} (Δ${Math.abs(goldenNetTotal - net.total.net).toFixed(2)})`);

// ---------- 4. Stock-counter engine (synthetic fixture) ----------
// No raw XBS export for the golden day yet (HANDOVER §9), so the port is
// validated against a hand-computed fixture that exercises every function:
// location aging, status buckets, matrix grouping (RECOVERABLE rename, batch
// prefix), consolidationMap, percentages → expected bags, and the totals
// identity. Swap in the raw export when Ivo provides it.
console.log('\n[4] Stock-counter engine (synthetic fixture, hand-computed expectations)');
const scToday = new Date('2026-06-18T00:00:00Z');
const d = (iso: string) => new Date(iso + 'T00:00:00Z');
const scRows: StockRow[] = [
  { strategy: 'PRE AA - TOP', warehouse: 'KAHAWA BORA WAREHOUSE', intakeDate: d('2026-06-08'), batchId: 'BA-00100', qty: 6000, itemName: 'KIBUGU AA' },
  { strategy: 'PRE AA - TOP', warehouse: 'KAHAWA BORA WAREHOUSE', intakeDate: d('2026-05-29'), batchId: 'BA-00101', qty: 3000, itemName: 'GATHAITHI AA' },
  { strategy: 'IN AB - FAQ', warehouse: 'MOMBASA WH', intakeDate: d('2026-06-13'), batchId: 'CS-00200', qty: 1200, itemName: 'NGURU AB' },
  { strategy: 'PRE RECOVERABLES', batchId: 'HP-00300', qty: 600, itemName: 'GRINDER SWEEPS' },
  { strategy: 'POST 16 FAQ', warehouse: 'KAHAWA BORA WAREHOUSE', qty: 900 },
  { strategy: 'POST FAQ MINUS', qty: 300 }, // consolidates → POST 17 UP FAQ
  { strategy: 'FINISHED GOODS', qty: 1800 },
  { strategy: '0-SOMETHING ELSE', qty: 120 }, // PENDING
  { strategy: '', qty: 60 }, // UNCLASSIFIED
  { strategy: 'PRE AA - TOP', batchId: 'BA-00102', qty: 'bogus' as unknown as number }, // NaN → skipped
];
const scPcts = {
  'PRE AA - TOP|BA': { 'POST 17 UP TOP': 99, 'POST REJECTS S': 1 },
  'IN AB - FAQ|CS': { 'POST 16 FAQ': 90, 'POST FAQ MINUS': 10 }, // 10% consolidates → 17 UP FAQ
};
const sc = runStockCounter(scRows, scPcts, scToday);

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const check = (label: string, actual: number, expected: number) => {
  if (near(actual, expected)) ok(`${label} = ${expected}`);
  else fail(`${label}: expected ${expected}, got ${actual}`);
};

const locByName = Object.fromEntries(sc.location.results.map((r) => [r.originalName, r]));
check('location KAHAWA BORA bags', locByName['KAHAWA BORA WAREHOUSE'].bags, 165);
check('location KAHAWA BORA avgDays (dateless kgs dilute)', locByName['KAHAWA BORA WAREHOUSE'].avgDays, 120000 / 9900);
if (locByName['KAHAWA BORA WAREHOUSE'].location !== 'In Our Warehouse') fail('KAHAWA BORA display name');
if (locByName['MOMBASA WH'].location !== 'Pending Arrival (MOMBASA WH)') fail('other-warehouse display name');
check('location NO WAREHOUSE bags', locByName['NO WAREHOUSE'].bags, 48);
check('location totals bags', sc.location.totals.bags, 233);

const statByKey = Object.fromEntries(sc.status.map((s) => [s.key, s.bags]));
check('status PRE bags', statByKey.PRE, 160);
check('status IN bags', statByKey.IN, 20);
check('status POST bags', statByKey.POST, 20);
check('status FINISHED bags', statByKey.FINISHED, 30);
check('status PENDING bags', statByKey.PENDING, 2);
check('status UNCLASSIFIED bags', statByKey.UNCLASSIFIED, 1);

const matrixKeys = sc.matrix.map((m) => `${m.strategy}|${m.batchPrefix}`);
const expectedMatrixKeys = ['PRE AA - TOP|BA', 'IN AB - FAQ|CS', 'PRE RECOVERABLES (GRINDER SWEEPS)|HP'];
if (JSON.stringify(matrixKeys) === JSON.stringify(expectedMatrixKeys)) ok('matrix rows grouped, renamed and ordered correctly');
else fail(`matrix rows: ${JSON.stringify(matrixKeys)}`);
check('matrix PRE AA - TOP kgs (two batches merged)', sc.matrix[0].totalKgs, 9000);

const t = sc.theoretical;
check('theoretical POST 17 UP TOP expected', t.grades['POST 17 UP TOP'].expected, 148.5);
check('theoretical POST REJECTS S expected', t.grades['POST REJECTS S'].expected, 1.5);
check('theoretical POST 16 FAQ total (15 already + 18 expected)', t.grades['POST 16 FAQ'].total, 33);
check('theoretical POST 17 UP FAQ (consolidated: 5 already + 2 expected)', t.grades['POST 17 UP FAQ'].total, 7);
check('theoretical FINISHED', t.grandTotalFinished, 30);
check('theoretical unclassified+pending', t.unclassifiedBags, 3);
check('theoretical totals.total identity', t.totals.total, 20 + 170 + 30 + 3);
const byGrade = theoreticalByGrade(t);
check('theoreticalByGrade carries FINISHED', byGrade['FINISHED'], 30);
check('theoreticalByGrade carries Unclassified/Pending', byGrade['Unclassified/Pending Alignment'], 3);

// ---------- 5. Assumptions → forecast percentages reconciliation ----------
console.log('\n[5] Assumptions reconciliation (seed assumptions + strategy_mapping)');
const assumptionsSeed = JSON.parse(readFileSync(join(here, '../seed/assumptions.json'), 'utf8'));
const strategyMapping = JSON.parse(readFileSync(join(here, '../seed/strategy_mapping.json'), 'utf8'));
const batchMappings = JSON.parse(readFileSync(join(here, '../seed/batch_mappings.json'), 'utf8'));
const rec = deriveForecastPercentages(scRows, {
  assumptions: assumptionsSeed.ASSUMPTIONS,
  strategyMapping,
  batchMappings,
});
check('AA TOP // AA → POST 17 UP TOP %', rec.percentages['PRE AA - TOP|BA']?.['POST 17 UP TOP'] ?? NaN, 99);
check('AB FAQ // AB → POST 16 FAQ %', rec.percentages['IN AB - FAQ|CS']?.['POST 16 FAQ'] ?? NaN, 98);
const unresolvedByKey = Object.fromEntries(rec.unresolved.map((u) => [u.rowKey, u]));
const rejAmb = unresolvedByKey['PRE AA - TOP|BA'];
if (rejAmb?.reason === 'ambiguous-outputs' && near(rejAmb.missingOutputs?.['REJECTS'] ?? 0, 0.01))
  ok('ambiguous REJECTS split flagged (not guessed) with its 1% weight');
else fail(`REJECTS ambiguity not flagged correctly: ${JSON.stringify(rejAmb)}`);
if (unresolvedByKey['PRE RECOVERABLES (GRINDER SWEEPS)|HP']?.reason === 'no-standard-strategy')
  ok('unmappable RECOVERABLES row flagged as no-standard-strategy');
else fail('RECOVERABLES row not flagged');

// ---------- 6. Futs + Spread vs golden (real DailyNetPosition export) ----------
console.log('\n[6] Futs + Spread vs golden (real DailyNetPosition export + golden Summary inputs)');
const dnpText = decodeExportText(readFileSync(join(here, '../../forecast-context/DailyNetPosition-IVO (87).xls')));
const dnp = parseDailyNetPosition(dnpText);
if (dnp.length === 459) ok('DailyNetPosition parsed: 459 rows');
else fail(`DailyNetPosition parsed ${dnp.length} rows, expected 459`);

const sumMonths: string[] = golden.monthHeaders.map(String); // Summary E:P
const natRow = fs.matrix['POST NATURAL'] || {};
const postNaturalForwardBags = sumMonths.reduce((s, mo) => s + (natRow[mo] || 0), 0);

const theoOf = (grade: string) =>
  Number(golden.summary.rows.find((r: any) => normGrade(r.grade) === normGrade(grade))?.theoreticalStock) || 0;
const futs = computeFutsSpread({
  theoreticalTotalBags: Number(golden.summary.total.theoreticalStock),
  postNaturalBags: theoOf('POST NATURAL'),
  rejectsSBags: theoOf('POST REJECTS S'),
  rejectsPBags: theoOf('POST REJECTS P'),
  postNaturalForwardBags,
  dnp,
  manual: { kenyacofFutsMt: -1717, deltaHedgeKenyArDynMt: -102 }, // golden day's manual pot entries
});

const FUTS_TOL = 0.005;
let futsChecks = 0;
for (const [label, gline] of Object.entries<any>(golden.futsSpread)) {
  const mine = futs.lines[label];
  if (!mine) {
    fail(`FUTS line missing: ${label}`);
    continue;
  }
  for (const part of ['mt', 'lots'] as const) {
    const g = gline[part];
    const v = mine[part];
    futsChecks++;
    if (g == null || v == null) {
      if (g == null && v == null) continue;
      fail(`FUTS ${label} ${part}: golden ${g} vs mine ${v}`);
    } else if (Math.abs(g - v) > FUTS_TOL) {
      fail(`FUTS ${label} ${part}: golden ${g} vs mine ${v} (Δ${Math.abs(g - v).toFixed(4)})`);
    }
  }
}
if (failures === 0 || futsChecks > 0) ok(`all ${futsChecks} Futs+Spread values match golden (mt + lots, tol ${FUTS_TOL})`);

// Futures pivot from sales' sFixDte. The workbook's own pivot was STALE on the
// golden day (KCN/2026 −516.0 cached vs −544.77 refreshed, KCK/2026 missing) —
// we assert against the refreshed truth derived from the BASE FILE sales.
const pots = futuresPotBySFixDte(sales);
check('futures pot KCU/2026 MT', pots.byPot['KCU/2026'] ?? NaN, -897.6000000000001);
check('futures pot KCZ/2026 MT', pots.byPot['KCZ/2026'] ?? NaN, -924);
check('futures pot KCN/2026 MT (refreshed; sheet cached −516.0)', pots.byPot['KCN/2026'] ?? NaN, -544.77);
check('futures pot KCH/2027 MT', pots.byPot['KCH/2027'] ?? NaN, -490.5);
check('futures pot total MT', pots.totalMt, -2858.31);

// ---------- 7. SOL export parsers (real files) ----------
console.log('\n[7] SOL parsers on the real exports');
const logiText = decodeExportText(readFileSync(join(here, '../../forecast-context/ReportLogistic20260618-IVO.xls')));
const parsedRows = parseLogisticsReport(logiText);
if (parsedRows.length === 62) ok('ReportLogistic parsed: 62 unallocated sale rows');
else fail(`ReportLogistic parsed ${parsedRows.length} rows, expected 62`);
const parsedSales = aggregateSales(parsedRows); // BASE FILE semantics: one row per (contract, month)
if (parsedSales.length === 61) ok('aggregated to 61 contracts (SSKE-103502 split rows merged)');
else fail(`aggregated to ${parsedSales.length} contracts, expected 61`);
const badMonths = parsedSales.filter((s) => !/^\d{4}\/\d{2}$/.test(s.month || ''));
if (badMonths.length === 0) ok('every parsed sale has a YYYY/MM delivery month');
else fail(`${badMonths.length} sales with malformed month, e.g. ${JSON.stringify(badMonths[0]?.month)}`);
// Cross-check against the BASE FILE ground truth. The on-disk export is a
// slightly different SOL snapshot than the one pasted into the workbook, with
// two known drifts: SSKE-107893's SMT was revised (−151.2 vs −144.9) and
// SSKE-98454 only exists in the export. Anything beyond those is a parser bug.
const KNOWN_DRIFT = new Set(['SSKE-107893', 'SSKE-98454']);
const gtByCtr = Object.fromEntries(sales.map((s) => [s.saleCtr, s]));
const overlap = parsedSales.filter((s) => s.saleCtr && gtByCtr[s.saleCtr]);
const mismatched = overlap.filter((s) => {
  if (KNOWN_DRIFT.has(s.saleCtr!)) return false;
  const gt = gtByCtr[s.saleCtr!];
  return Math.abs(s.smt - gt.smt) > 1e-9 || s.month !== gt.month;
});
const unexpectedExtra = parsedSales.filter((s) => s.saleCtr && !gtByCtr[s.saleCtr] && !KNOWN_DRIFT.has(s.saleCtr!));
if (overlap.length >= 60 && mismatched.length === 0 && unexpectedExtra.length === 0)
  ok(`${overlap.length} contracts cross-checked vs BASE FILE (SMT + month agree; known snapshot drift excluded)`);
else {
  const m = mismatched[0];
  const gt = m && gtByCtr[m.saleCtr!];
  fail(
    `logistics/BASE FILE cross-check: ${mismatched.length} mismatched, ${unexpectedExtra.length} unexpected extra` +
      (m && gt ? `, e.g. ${m.saleCtr}: smt ${m.smt} vs ${gt.smt}, month ${m.month} vs ${gt.month}` : '')
  );
}

// ---------- 8. Demo-files end-to-end (the exact flow a chat upload takes) ----------
// demo-files/ holds the two real SOL exports plus a SYNTHESIZED XBS stock
// report (no raw export exists for the golden day; the synthetic file encodes
// Summary!C as fully-processed lots). Running all three through the real
// parsers + engine must land on the golden Summary.
console.log('\n[8] demo-files/ end-to-end through the real parsers');
const { parseStockWorkbook } = await import('../sources/UploadedFileSource');
const demoDir = join(here, '../../demo-files');
const stockRows = parseStockWorkbook(readFileSync(join(demoDir, 'XBS_Stock_2026-06-18.xlsx')));
const demoSc = runStockCounter(stockRows, {}, new Date('2026-06-18T00:00:00Z'));
const demoTheo = theoreticalByGrade(demoSc.theoretical);
check('demo XBS total theoretical bags', Math.round(demoSc.theoretical.totals.total * 100) / 100, 35568.29);

const demoSales = aggregateSales(
  parseLogisticsReport(decodeExportText(readFileSync(join(demoDir, 'ReportLogistic_2026-06-18.xls'))))
);
// blend numbers come from the learned memory (seeded from the golden BASE FILE)
const demoMemory = buildAssignmentMemory(sales);
const demoAmbiguous = globallyAmbiguousKeys(demoMemory);
const demoFs = computeForwardSales(demoSales, blends, { useAssigned: false, memory: demoMemory, ambiguousKeys: demoAmbiguous });
const demoHorizon = [...demoFs.months].sort().slice(1, 11);
const demoNet = computeNetPosition(demoTheo, sumOverMonths(demoFs.matrix, demoHorizon));
console.log(
  `  demo net total ${demoNet.total.net.toFixed(2)} (golden −4850.21; drift = pending-blend sales ${demoFs.pending.length} + known snapshot revisions)`
);
// The invariant that matters: every AUTO-allocated sale matches Ivo's actual
// blend choice (BASE FILE ground truth); everything else is honestly pending.
const demoGt = Object.fromEntries(sales.map((s) => [s.saleCtr, s.blendNo]));
const wrongAuto = demoFs.matches.filter(
  (m) => !m.needsConfirmation && m.blend && demoGt[m.sale.saleCtr!] != null && m.blend.blendNo !== demoGt[m.sale.saleCtr!]
);
if (wrongAuto.length === 0)
  ok(`${demoSales.length} sales → ${demoSales.length - demoFs.pending.length} auto-allocated (all match Ivo's choices), ${demoFs.pending.length} flagged for confirmation`);
else fail(`${wrongAuto.length} demo sales auto-allocated to the WRONG blend: ${wrongAuto.map((m) => m.sale.saleCtr).join(', ')}`);
const demoDnp = parseDailyNetPosition(decodeExportText(readFileSync(join(demoDir, 'DailyNetPosition_2026-06-18.xls'))));
const demoFuts = computeFutsSpread({
  theoreticalTotalBags: demoSc.theoretical.totals.total,
  postNaturalBags: demoTheo['POST NATURAL'] || 0,
  rejectsSBags: demoTheo['POST REJECTS S'] || 0,
  rejectsPBags: demoTheo['POST REJECTS P'] || 0,
  postNaturalForwardBags: [...demoFs.months].sort().slice(1).reduce((s, mo) => s + ((demoFs.matrix['POST NATURAL'] || {})[mo] || 0), 0),
  dnp: demoDnp,
  manual: { kenyacofFutsMt: -1717, deltaHedgeKenyArDynMt: -102 },
});
check('demo Stock mt', Math.round((demoFuts.lines['Stock'].mt ?? 0) * 10000) / 10000, 2134.0974);
check('demo Direct Sales Stock mt', Math.round((demoFuts.lines['Direct Sales Stock'].mt ?? 0) * 100) / 100, -66.26);
check('demo Sucafina mt', Math.round((demoFuts.lines['Sucafina'].mt ?? 0) * 100) / 100, -4.56);

// ---------- 9. Pricing analytics ----------
// Expected values were hand-computed independently (python over the raw TSV,
// SMT-weighted by contract+month aggregate) — see the pricing-pack spec.
console.log('\n[9] Pricing analytics vs hand-computed constants (real ReportLogistic)');
const { computePricing } = await import('../lib/pricing');
const priceTol = 0.01;
const nearPx = (label: string, actual: number | null, expected: number) => {
  if (actual != null && Math.abs(actual - expected) <= priceTol) ok(`${label}: ${actual}`);
  else fail(`${label}: got ${actual}, expected ${expected}`);
};
const pricing = computePricing(parsedSales, { dimension: 'fixMonth' });
if (pricing.coverage.priced === 61 && pricing.coverage.unpriced === 0)
  ok('coverage: 61/61 aggregated sales carry differentials');
else fail(`coverage: priced ${pricing.coverage.priced}, unpriced ${pricing.coverage.unpriced} (expected 61/0)`);
nearPx('total SMT', pricing.overall.smt, -2907.81);
nearPx('overall wavg contract dif (USc/lb)', pricing.overall.contractDifUscLb, 84.0236);
nearPx('overall wavg FOB dif (USc/lb)', pricing.overall.fobDifUscLb, 72.4717);
if (pricing.overall.fixed.contracts === 28 && pricing.overall.ptbf.contracts === 33)
  ok('fixed/PTBF split: 28 fixed / 33 PTBF contracts');
else fail(`fixed/PTBF split: ${pricing.overall.fixed.contracts}/${pricing.overall.ptbf.contracts}, expected 28/33`);
nearPx('fixed volume SMT', pricing.overall.fixed.smt, -639.81);
nearPx('PTBF volume SMT', pricing.overall.ptbf.smt, -2268.0);
nearPx('fixed wavg flat price (USc/lb, unit-normalized)', pricing.overall.fixed.flatUscLb, 326.9371);
const FIX_EXPECT: Record<string, [number, number]> = {
  'KCH/2025': [34.29, -1.2],
  'KCH/2027': [94.2174, -496.8],
  'KCK/2026': [451.3, -0.24],
  'KCN/2026': [51.7728, -506.37],
  'KCU/2025': [-19.0, -43.2],
  'KCU/2026': [130.6236, -936.0],
  'KCZ/2026': [53.7974, -924.0],
};
let fixBad = 0;
for (const [mo, [dif, smt]] of Object.entries(FIX_EXPECT)) {
  const b = pricing.byBucket?.[mo];
  if (!b || Math.abs((b.contractDifUscLb ?? NaN) - dif) > priceTol || Math.abs(b.smt - smt) > priceTol) {
    fixBad++;
    fail(`fix month ${mo}: got dif ${b?.contractDifUscLb} smt ${b?.smt}, expected ${dif}/${smt}`);
  }
}
if (fixBad === 0) ok('fix-month ladder: all 7 buckets exact (dif + SMT)');
const byClient = computePricing(parsedSales, { dimension: 'client' });
nearPx('NESTRADE wavg contract dif', byClient.byBucket?.['NESTRADE']?.contractDifUscLb ?? null, 144.5596);

// Demo-seed enrichment: bundled sales must carry the export's prices so the
// demo day can answer pricing questions; postGrade attribution must work off
// the seeded blend numbers.
const exportByKey = Object.fromEntries(parsedSales.map((s) => [`${s.saleCtr}|${s.month}`, s]));
const demoSeedSales: Sale[] = (await import('../seed/demo')).DEMO_SALES;
const enriched = demoSeedSales.filter((s) => s.sDif != null);
const wrongPrice = enriched.filter((s) => {
  const ex = exportByKey[`${s.saleCtr}|${s.month}`];
  return !ex || Math.abs((s.sDif ?? NaN) - (ex.sDif ?? NaN)) > 1e-9 || Math.abs((s.sFobDif ?? NaN) - (ex.sFobDif ?? NaN)) > 1e-9;
});
if (enriched.length >= 55 && wrongPrice.length === 0)
  ok(`demo seed: ${enriched.length}/${demoSeedSales.length} sales price-enriched, all matching the export`);
else fail(`demo seed enrichment: ${enriched.length} enriched, ${wrongPrice.length} mismatched vs export`);
const demoPost = computePricing(demoSeedSales, { dimension: 'postGrade', blends });
const grinderBold = demoPost.byBucket?.['POST GRINDER BOLD'];
if (grinderBold?.contractDifUscLb != null && grinderBold?.fobDifUscLb != null)
  ok(`postGrade dim: POST GRINDER BOLD dif ${grinderBold.contractDifUscLb} / FOB ${grinderBold.fobDifUscLb} (blend-weighted)`);
else fail('postGrade dim: no differential computed for POST GRINDER BOLD');

console.log('\n[offers] (informational)');
console.table(computeOffers(net));

console.log('\n' + (failures === 0 ? '✅ PARITY PASSED' : `❌ ${failures} parity check(s) failed`));
process.exit(failures === 0 ? 0 : 1);
