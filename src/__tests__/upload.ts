/**
 * Re-upload / file-change edge-case harness (QA round 3, 2026-07-13).
 *
 * 17 cases covering re-ingestion of the three desk exports against the
 * race-free ingestion architecture (per-(positionDate,kind) snapshot_inputs
 * docs). Everything runs on SYNTHETIC/MOCKED inputs: lua-cli's `Data` API is
 * monkey-patched with an in-memory fake (it is a plain mutable object shared
 * by reference with store.ts), parsers are fed hand-built export text, and
 * the ingest tools' CDN layer is skipped by mirroring their execute() bodies.
 *
 * Run: npx tsx src/__tests__/upload.ts     (exit 0 = pass; ⚠ FINDING lines
 * are product findings for the triage report, not harness failures)
 */
import { Data } from 'lua-cli';

// ---------------------------------------------------------------------------
// In-memory fake Data layer — must be installed BEFORE any store.ts call.
// Semantics mirror the real API as store.ts uses it: docs are {id, data},
// get() filters by strict === on top-level fields and returns
// {data, pagination}, update() shallow-merges into the doc's data.
// ---------------------------------------------------------------------------
type Doc = { id: string; data: Record<string, any> };
const db = new Map<string, Doc[]>();
let seq = 0;
let jitterMs = 0; // >0 = random await between ops (fuzz mode)
const hooks: { afterGet?: (collection: string, filter: any) => Promise<void> } = {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = (x: any) => (x === undefined ? x : structuredClone(x));
const matches = (d: Doc, f?: any) => !f || Object.entries(f).every(([k, v]) => d.data[k] === v);
const coll = (c: string) => db.get(c) ?? db.set(c, []).get(c)!;
const pause = async () => { if (jitterMs) await sleep(Math.random() * jitterMs); };

Object.assign(Data, {
  async get(c: string, f?: any, page = 1, limit = 10) {
    await pause();
    const hit = coll(c).filter((d) => matches(d, f));
    if (hooks.afterGet) await hooks.afterGet(c, f);
    return {
      data: clone(hit.slice((page - 1) * limit, page * limit)),
      pagination: { totalPages: Math.ceil(hit.length / limit) || 1, currentPage: page },
    };
  },
  async create(c: string, data: any) {
    await pause();
    const doc = { id: `id-${++seq}`, data: clone(data) };
    coll(c).push(doc);
    return clone(doc);
  },
  async update(c: string, id: string, data: any) {
    await pause();
    const doc = coll(c).find((d) => d.id === id);
    if (!doc) throw new Error(`fake Data.update miss: ${c}/${id}`);
    Object.assign(doc.data, clone(data));
    return clone(doc);
  },
  async delete(c: string, id: string) {
    await pause();
    const a = coll(c);
    const i = a.findIndex((d) => d.id === id);
    if (i >= 0) a.splice(i, 1);
  },
  async search() { throw new Error('fake Data.search: not implemented (unexpected call)'); },
  async getEntry() { throw new Error('fake Data.getEntry: not implemented (unexpected call)'); },
});

const resetDb = () => { db.clear(); seq = 0; jitterMs = 0; hooks.afterGet = undefined; };
const dump = (c: string, f?: any): Doc[] => coll(c).filter((d) => matches(d, f)).map((d) => structuredClone(d));

// store/pipeline import AFTER the patch (they dereference Data.* at call
// time, so order is belt-and-braces, not load-bearing)
import {
  COLLECTIONS,
  saveSnapshot,
  getSnapshot,
  deleteSnapshot,
  clearDemoSnapshot,
  upsert,
  getAll,
  refuseEmptyIngest,
} from '../skills/store';
import { runComputeChain } from '../skills/pipeline';
import { xbsReportDate, dnpReportDate, resolvePositionDate } from '../lib/reportdate';
import { decodeExportText, parseDailyNetPosition, parseLogisticsReport, aggregateSales } from '../lib/parse';
import { parseXbsStock } from '../sources/UploadedFileSource';
import { citeLine } from '../lib/cite';
import { DEMO_DNP, DEMO_THEORETICAL, DEMO_MANUAL_INPUTS } from '../seed/demo';

// ---------------------------------------------------------------------------
// Harness conventions (parity.ts style) + a findings channel
// ---------------------------------------------------------------------------
let failures = 0;
let findings = 0;
const fail = (msg: string) => { failures++; console.log('  ✗ ' + msg); };
const ok = (msg: string) => console.log('  ✓ ' + msg);
const finding = (msg: string) => { findings++; console.log('  ⚠ FINDING: ' + msg); };
const section = (n: number, title: string) => console.log(`\n[${n}] ${title}`);

/** Canonical JSON: keys sorted recursively, volatile fields dropped. */
function canon(x: any): any {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(x).sort()) {
      if (k === 'updatedAt' || k === 'id') continue;
      out[k] = canon(x[k]);
    }
    return out;
  }
  return x;
}
const eq = (label: string, actual: any, expected: any) => {
  const a = JSON.stringify(canon(actual));
  const e = JSON.stringify(canon(expected));
  if (a === e) ok(label);
  else fail(`${label}: got ${a?.slice(0, 200)} … expected ${e?.slice(0, 200)}`);
};
async function expectThrows(label: string, fn: () => any, re: RegExp) {
  try {
    await fn();
    fail(`${label}: expected an Error matching ${re}, nothing was thrown`);
  } catch (err: any) {
    if (re.test(String(err?.message ?? err))) ok(label);
    else fail(`${label}: threw "${String(err?.message ?? err).slice(0, 160)}" not matching ${re}`);
  }
}

// ---------------------------------------------------------------------------
// Synthetic export builders (headers copied from the real parsers' col maps)
// ---------------------------------------------------------------------------
const XBS_HEADER = 'Position Strategy Allocation,Warehouse,Intake Date,Stock In Day(s),Batch No.,Qty.,Item Name,Blocked,Item Phase,Inventory Type,Certification';
/** rows: [strategy, intakeDate ('01-JUN-2026'), stockInDays, qtyKg] */
const xbsCsv = (rows: Array<[string, string, number, number]>): Buffer =>
  Buffer.from([XBS_HEADER, ...rows.map(([s, d, days, qty]) => `${s},WH1,${d},${days},B001,${qty},Item,No,Post,MC 25/26,`)].join('\n'));

const DNP_HEADER = ['Quality', 'State', 'Company', 'P.MT', 'S.MT', 'TotLine', 'certification', 'DatePos'].join('\t');
/** rows: [quality, pMt, sMt, datePos ('18-06-2026')] */
const dnpTsv = (rows: Array<[string, number, number, string]>): string =>
  [DNP_HEADER, ...rows.map(([q, p, s, d]) => [q, 'STATE', 'CO', p, s, p + s, '', d].join('\t'))].join('\n');

const LOGI_COLS = ['Status', 'Sale Ctr.', 'Client', 'S.Grade', 'S.Cup Profile', 'S.strategy', 'SMT', 'S.bags', 'S.Ship.', 'sFixDte', 'S. Price', 'S. Unit', 'S.Dif', 'S.Fob dif', 'S.Term', 'S.City', 'S.CodCountry', 'Payment term', 'Trader', 'S.Cert', 'PreshipID', 'Booking Line', 'Vessel', 'Voy.Num', 'Booking num.', 'TransType', 'POL', 'POD', 'ETD', 'ETA', 'SI.Date'];
/** rows: partial records keyed by LOGI_COLS names; Status defaults to unallocated. */
const logiTsv = (rows: Array<Record<string, string | number>>): string =>
  [
    LOGI_COLS.join('\t'),
    ...rows.map((r) =>
      LOGI_COLS.map((c) => String(r[c] ?? (c === 'Status' ? '6-Sales Unallocated' : '0'))).join('\t')
    ),
  ].join('\n');

// ---------------------------------------------------------------------------
// Ingest mirrors — the tools' execute() bodies minus the CDN fetch.
// Mirror of IngestStockReport.execute (ingestion.skill.ts:44-98; summaries
// reduced to what these tests assert on — the full summary shape is parity's
// concern, not re-upload semantics').
// ---------------------------------------------------------------------------
async function ingestStock(bytes: Uint8Array | Buffer, provided?: string) {
  const rows = parseXbsStock(bytes instanceof Buffer ? new Uint8Array(bytes) : bytes);
  const dateRes = resolvePositionDate(xbsReportDate(rows), provided, 'XBS Current Stock export');
  await refuseEmptyIngest('XBS Current Stock export', 'stock', rows.length, dateRes.positionDate);
  await clearDemoSnapshot(dateRes.positionDate);
  await saveSnapshot(dateRes.positionDate, { stock: { rowCount: rows.length, postBags: {}, matrix: [], status: [], groups: [] } });
  return { ...dateRes, rows };
}
/** Mirror of IngestDailyNetPosition.execute (ingestion.skill.ts:107-126). */
async function ingestDnp(text: string | Buffer, provided?: string) {
  const dnp = parseDailyNetPosition(typeof text === 'string' ? text : decodeExportText(new Uint8Array(text)));
  const dateRes = resolvePositionDate(dnpReportDate(dnp), provided, 'SOL DailyNetPosition export');
  await refuseEmptyIngest('SOL DailyNetPosition export', 'dnp', dnp.length, dateRes.positionDate);
  await clearDemoSnapshot(dateRes.positionDate);
  await saveSnapshot(dateRes.positionDate, { dnp });
  return { ...dateRes, dnp };
}
/** Mirror of IngestLogisticsReport.execute (ingestion.skill.ts:134-172). */
async function ingestLogistics(text: string | Buffer, provided?: string) {
  const dateRes = resolvePositionDate({ date: null, agree: 0, total: 0 }, provided, 'SOL ReportLogistic export');
  const sales = aggregateSales(parseLogisticsReport(typeof text === 'string' ? text : decodeExportText(new Uint8Array(text))));
  await refuseEmptyIngest('SOL ReportLogistic export', 'sales', sales.length, dateRes.positionDate);
  await clearDemoSnapshot(dateRes.positionDate);
  await saveSnapshot(dateRes.positionDate, { sales });
  return { ...dateRes, sales };
}
/** Mirror of DeleteSnapshot.execute's pending purge (ingestion.skill.ts:240-241). */
async function purgePendings(positionDate: string) {
  const pend = await Data.get(COLLECTIONS.pendingBlends, { positionDate }, 1, 100);
  for (const p of pend?.data ?? []) if (p?.id) await Data.delete(COLLECTIONS.pendingBlends, p.id);
  return (pend?.data ?? []).length;
}
/** Mirror of SetManualInputs.execute (position.skill.ts:97). */
const setManualInputs = (positionDate: string, manual: Record<string, any>) =>
  upsert(COLLECTIONS.manualInputs, { positionDate }, { positionDate, ...manual });

/** A sale no memory key matches → always lands in pending_blends. */
const pendingSale = (saleCtr: string, month = '2099/03') => ({
  saleCtr, client: 'ZZZ ROASTERS QA', sGrade: 'AB FAQ', cupProfile: null, sStrategy: 'POST AB FAQ',
  smt: 18, sbags: 300, month, sFixDte: null, blendNo: null, sPrice: 0, sPriceUnit: null,
  sDif: null, sFobDif: null, sTerm: null, sCity: null, sCountry: null, paymentTerm: null,
  trader: null, sCert: null, booking: null,
});

const P = (marker: string) => ({ marker, rowCount: 1 });

(async () => {
  // ---------- 1. Re-upload same kind + same date twice ----------
  section(1, 'Same kind + date uploaded twice — clean overwrite, no duplicates');
  {
    resetDb();
    const D = '2099-01-01';
    await saveSnapshot(D, { dnp: P('dnp-v1') });
    await saveSnapshot(D, { dnp: P('dnp-v1') });
    const docs = dump(COLLECTIONS.snapshotInputs, { positionDate: D, kind: 'dnp' });
    if (docs.length === 1) ok('exactly one (date, dnp) input doc after double upload');
    else fail(`expected 1 input doc, found ${docs.length}`);
    eq('payload unchanged', docs[0]?.data.payload, P('dnp-v1'));
    eq('no pending blends appeared', dump(COLLECTIONS.pendingBlends).length, 0);
    const snap = await getSnapshot(D);
    eq('getSnapshot serves the payload once', snap?.data.dnp, P('dnp-v1'));
  }

  // ---------- 2. Re-upload 1 of 3 for a date that has the other 2 ----------
  section(2, 'Re-upload one kind — the other two survive untouched (2026-07-10 regression)');
  {
    resetDb();
    const D = '2099-01-02';
    await saveSnapshot(D, { stock: P('stock-v1') });
    await saveSnapshot(D, { dnp: P('dnp-v1') });
    await saveSnapshot(D, { sales: [P('sale-v1')] });
    await saveSnapshot(D, { sales: [P('sale-v2')] }); // the re-upload
    const snap = await getSnapshot(D);
    eq('stock untouched', snap?.data.stock, P('stock-v1'));
    eq('dnp untouched', snap?.data.dnp, P('dnp-v1'));
    eq('sales replaced by re-upload', snap?.data.sales, [P('sale-v2')]);
    eq('still exactly 3 input docs', dump(COLLECTIONS.snapshotInputs, { positionDate: D }).length, 3);
  }

  // ---------- 3. Upload order must not matter ----------
  section(3, 'All 6 upload orderings produce an identical snapshot');
  {
    const parts: Array<[string, any]> = [['stock', P('s')], ['dnp', P('d')], ['sales', [P('x')]]];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const shapes = new Set<string>();
    for (const perm of perms) {
      resetDb();
      const D = '2099-01-03';
      for (const i of perm) await saveSnapshot(D, { [parts[i][0]]: parts[i][1] });
      shapes.add(JSON.stringify(canon((await getSnapshot(D))?.data)));
    }
    if (shapes.size === 1) ok('snapshot identical across all 6 orderings');
    else fail(`orderings diverged into ${shapes.size} distinct snapshots`);
  }

  // ---------- 4. Rows disagreeing on the date → majority + warning ----------
  section(4, 'XBS rows disagree on report date — majority vote wins, warning surfaced');
  {
    // 3 rows vote 2026-06-18 (intake+days), 1 malformed row votes 2026-06-19
    const rows = parseXbsStock(xbsCsv([
      ['POST 16 FAQ', '01-JUN-2026', 17, 600],
      ['POST 16 FAQ', '10-JUN-2026', 8, 600],
      ['POST AB FAQ', '18-JUN-2026', 0, 600],
      ['POST AB FAQ', '18-JUN-2026', 1, 600],
    ]));
    const sniffed = xbsReportDate(rows);
    if (sniffed.date === '2026-06-18' && sniffed.agree === 3 && sniffed.total === 4) ok(`split vote sniffs ${sniffed.agree}/${sniffed.total} → ${sniffed.date}`);
    else fail(`expected 3/4 → 2026-06-18, got ${JSON.stringify(sniffed)}`);
    const res = resolvePositionDate(sniffed, undefined, 'XBS Current Stock export');
    eq('majority date wins', res.positionDate, '2026-06-18');
    if (res.warnings.some((w) => /rows disagree on the report date/.test(w))) ok('disagreement warning present');
    else fail(`no disagreement warning in ${JSON.stringify(res.warnings)}`);
  }

  // ---------- 5. Trader-provided date conflicts with derived ----------
  section(5, 'Provided date conflicts with derived — export date wins, conflict warned');
  {
    const res = resolvePositionDate({ date: '2026-06-18', agree: 10, total: 10 }, '2026-06-19', 'XBS Current Stock export');
    eq('derived date wins', res.positionDate, '2026-06-18');
    if (res.warnings.some((w) => /You said 2026-06-19.*rows say 2026-06-18.*export's date always wins/.test(w))) ok('conflict warning relayed');
    else fail(`conflict warning missing/reworded: ${JSON.stringify(res.warnings)}`);
    eq('dateSource says derived', res.dateSource, "derived from the export's own rows (10/10 rows)");
  }

  // ---------- 6. Logistics with NO date → refuse ----------
  section(6, 'ReportLogistic without a date — refuses, never defaults to today');
  {
    resetDb();
    await expectThrows(
      'resolvePositionDate throws the ask-the-trader error',
      () => resolvePositionDate({ date: null, agree: 0, total: 0 }, undefined, 'SOL ReportLogistic export'),
      /carries no derivable report date and none was provided.*Never assume it is today/
    );
    await expectThrows(
      'ingest mirror refuses before touching the store',
      () => ingestLogistics(logiTsv([{ 'Sale Ctr.': 'S1', Client: 'C', SMT: 10, 'S.Ship.': '2099/03/01' }])),
      /carries no derivable report date/
    );
    eq('nothing persisted on refusal', dump(COLLECTIONS.snapshotInputs).length, 0);
  }

  // ---------- 7. Logistics WITH date → trader-provided dateSource ----------
  section(7, 'ReportLogistic with a date — dateSource is trader-provided');
  {
    resetDb();
    const res = await ingestLogistics(
      logiTsv([{ 'Sale Ctr.': 'S1', Client: 'CLIENT A', 'S.Grade': 'AB FAQ', SMT: 18, 'S.Ship.': '2099/03/01' }]),
      '2099-01-07'
    );
    eq('dateSource', res.dateSource, 'trader-provided (no date derivable from the export rows)');
    // the disposable 2099 date correctly trips the R3-F2 future-date warning — it must be the ONLY one
    if (res.warnings.length === 1 && /in the FUTURE/.test(res.warnings[0])) ok('only the future-date warning (disposable 2099 date)');
    else fail(`unexpected warnings: ${JSON.stringify(res.warnings)}`);
    eq('sale stored under the provided date', ((await getSnapshot('2099-01-07'))?.data.sales ?? []).length, 1);
  }

  // ---------- 8. TRUE concurrency (the 2026-07-10 prod incident) ----------
  section(8, 'Parallel 3-file ingest — per-kind docs cannot clobber (deterministic barrier + fuzz)');
  {
    // (a) control: prove the harness reproduces the OLD single-doc race.
    // legacy mirror of pre-fix saveSnapshot: every key upserted into the one
    // shared snapshots doc — concurrent get-then-create duplicates it.
    const legacySaveSnapshot = (positionDate: string, patch: Record<string, any>) =>
      upsert(COLLECTIONS.snapshots, { positionDate }, { ...patch, positionDate, updatedAt: new Date().toISOString() });
    const makeBarrier = (n: number, collection: string) => {
      let count = 0;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      hooks.afterGet = async (c) => {
        if (c !== collection) return;
        count++;
        if (count >= n) release();
        await gate;
      };
    };
    resetDb();
    const D = '2099-01-08';
    makeBarrier(3, COLLECTIONS.snapshots);
    await Promise.all([
      legacySaveSnapshot(D, { stock: P('s') }),
      legacySaveSnapshot(D, { dnp: P('d') }),
      legacySaveSnapshot(D, { sales: [P('x')] }),
    ]);
    hooks.afterGet = undefined;
    const legacyDocs = dump(COLLECTIONS.snapshots, { positionDate: D });
    if (legacyDocs.length > 1) ok(`control: legacy single-doc design duplicates under the barrier (${legacyDocs.length} docs) — harness DOES catch the old bug`);
    else fail('control: legacy design did not race under the barrier — barrier is not exercising the interleaving');

    // (b) the real design under the same deterministic interleaving
    resetDb();
    makeBarrier(3, COLLECTIONS.snapshotInputs);
    await Promise.all([
      saveSnapshot(D, { stock: P('s') }),
      saveSnapshot(D, { dnp: P('d') }),
      saveSnapshot(D, { sales: [P('x')] }),
    ]);
    hooks.afterGet = undefined;
    const kinds = dump(COLLECTIONS.snapshotInputs, { positionDate: D }).map((d) => d.data.kind).sort();
    eq('one doc per kind, no duplicates, nothing lost', kinds, ['dnp', 'sales', 'stock']);
    const snap = await getSnapshot(D);
    if (snap?.data.stock && snap?.data.dnp && snap?.data.sales) ok('getSnapshot assembles all three inputs');
    else fail(`assembled snapshot is missing inputs: ${Object.keys(snap?.data ?? {}).join(',')}`);

    // (c) fuzz: random interleaving, computed-key writer racing alongside
    let fuzzFailed = false;
    for (let i = 0; i < 25 && !fuzzFailed; i++) {
      resetDb();
      jitterMs = 15;
      await Promise.all([
        saveSnapshot(D, { stock: P('s') }),
        saveSnapshot(D, { dnp: P('d') }),
        saveSnapshot(D, { sales: [P('x')] }),
        saveSnapshot(D, { theoretical: { totals: { total: 1 } } }),
      ]);
      jitterMs = 0;
      const s = (await getSnapshot(D))?.data;
      const inputDocs = dump(COLLECTIONS.snapshotInputs, { positionDate: D });
      if (!(s?.stock && s?.dnp && s?.sales && s?.theoretical) || inputDocs.length !== 3) {
        fuzzFailed = true;
        fail(`fuzz iteration ${i}: lost a write (inputs=${inputDocs.length}, keys=${Object.keys(s ?? {}).join(',')})`);
      }
    }
    if (!fuzzFailed) ok('25 fuzzed parallel ingests: no write ever lost');
  }

  // ---------- 9. Future-dated export ----------
  section(9, 'Future-dated export — accepted but WARNED, never blocked (R3-F2)');
  {
    resetDb();
    // through the ingest mirror (real wall clock — 2027-01-01 stays future until 2027)
    const res = await ingestDnp(dnpTsv([['HEDGEABLE', 10, -5, '01-01-2027']]));
    eq('future date accepted verbatim (warn, not block)', res.positionDate, '2027-01-01');
    if (res.warnings.some((w: string) => /in the FUTURE/.test(w))) ok('future-date warning emitted on ingest');
    else fail(`no future-date warning emitted: ${JSON.stringify(res.warnings)}`);
    // deterministic: both resolution paths, pinned `today`
    const derived = resolvePositionDate({ date: '2026-07-20', agree: 3, total: 3 }, undefined, 'SOL DailyNetPosition export', '2026-07-13');
    if (derived.warnings.some((w) => /2026-07-20 is in the FUTURE/.test(w))) ok('derived-date path warns against a pinned today');
    else fail(`derived-date path missing warning: ${JSON.stringify(derived.warnings)}`);
    const providedOnly = resolvePositionDate({ date: null, agree: 0, total: 0 }, '2026-07-20', 'SOL ReportLogistic export', '2026-07-13');
    if (providedOnly.warnings.some((w) => /2026-07-20 is in the FUTURE/.test(w))) ok('provided-date path warns against a pinned today');
    else fail(`provided-date path missing warning: ${JSON.stringify(providedOnly.warnings)}`);
    const past = resolvePositionDate({ date: '2026-07-10', agree: 3, total: 3 }, undefined, 'SOL DailyNetPosition export', '2026-07-13');
    eq('past dates stay warning-free', past.warnings, []);
  }

  // ---------- 10. Empty files ----------
  section(10, 'Empty exports — graceful refusal, no bogus date, nothing persisted');
  {
    resetDb();
    await expectThrows('header-only XBS refuses (no derivable date)', () => ingestStock(xbsCsv([])), /carries no derivable report date/);
    await expectThrows('empty DNP text refuses', () => ingestDnp(''), /carries no derivable report date/);
    await expectThrows('header-only DNP refuses', () => ingestDnp(DNP_HEADER), /carries no derivable report date/);
    eq('nothing persisted by any refusal', dump(COLLECTIONS.snapshotInputs).length, 0);
    // logistics is date-blind — an empty file + a provided date must still refuse (R3-F1)
    await expectThrows('empty logistics with a date refuses (zero-row guard)', () => ingestLogistics('', '2099-01-10'), /0 data rows/);
    // a provided date also bypasses the XBS/DNP date-derivation refusal — the guard must catch those too
    await expectThrows('header-only XBS with a provided date refuses', () => ingestStock(xbsCsv([]), '2099-01-10'), /0 data rows/);
    await expectThrows('header-only DNP with a provided date refuses', () => ingestDnp(DNP_HEADER, '2099-01-10'), /0 data rows/);
    eq('zero-row refusals persisted nothing', dump(COLLECTIONS.snapshotInputs, { positionDate: '2099-01-10' }).length, 0);
    // and the guard names the wipe hazard when a good book already exists for the date
    await saveSnapshot('2099-01-10', { sales: [P('good-sale')] });
    await expectThrows(
      'empty re-upload over an existing sales book names the hazard',
      () => ingestLogistics('', '2099-01-10'),
      /already exists for this date/
    );
    eq('existing sales book untouched by the refusal', (await getSnapshot('2099-01-10'))?.data.sales, [P('good-sale')]);
  }

  // ---------- 11. Malformed / wrong export fed to the wrong tool ----------
  section(11, 'Wrong or malformed file — clean error, not a crash');
  {
    const logiText = logiTsv([{ 'Sale Ctr.': 'S1', SMT: 1, 'S.Ship.': '2099/03/01' }]);
    const dnpText = dnpTsv([['HEDGEABLE', 1, -1, '18-06-2026']]);
    await expectThrows('logistics text into the DNP parser', () => parseDailyNetPosition(logiText), /Column not found: Quality/);
    await expectThrows('DNP text into the logistics parser', () => parseLogisticsReport(dnpText), /Column not found/);
    await expectThrows(
      'non-stock CSV into the XBS parser',
      () => parseXbsStock(new Uint8Array(Buffer.from('not,a,stock,file\n1,2,3,4'))),
      /does not look like an XBS stock report/
    );
    try {
      const junk = parseXbsStock(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0x03]));
      ok(`random binary into the XBS parser: no crash (returned ${junk.length} rows)`);
    } catch (err: any) {
      if (err instanceof Error) ok(`random binary into the XBS parser: clean Error ("${String(err.message).slice(0, 60)}…")`);
      else fail('random binary threw a non-Error value');
    }
  }

  // ---------- 12. delete-snapshot, then re-upload the same date ----------
  section(12, 'delete-snapshot then re-upload — pendings purged, manual inputs survive');
  {
    resetDb();
    const D = '2099-01-12';
    await saveSnapshot(D, { stock: P('s1'), dnp: P('d1'), sales: [P('x1')], theoretical: { totals: { total: 1 } } });
    await setManualInputs(D, DEMO_MANUAL_INPUTS);
    await upsert(COLLECTIONS.pendingBlends, { positionDate: D, saleCtr: 'S1' }, { positionDate: D, saleCtr: 'S1' });
    await upsert(COLLECTIONS.pendingBlends, { positionDate: D, saleCtr: 'S2' }, { positionDate: D, saleCtr: 'S2' });
    const deleted = await deleteSnapshot(D);
    const purged = await purgePendings(D);
    eq('deleteSnapshot reported docs removed', deleted, true);
    eq('pending confirmations purged with the snapshot', purged, 2);
    eq('snapshot fully gone', await getSnapshot(D), null);
    eq('input docs fully gone', dump(COLLECTIONS.snapshotInputs, { positionDate: D }).length, 0);
    const manual = dump(COLLECTIONS.manualInputs, { positionDate: D });
    if (manual.length === 1) {
      ok('manual hedge-pot inputs SURVIVE delete-snapshot (current semantics)');
      finding('delete-snapshot leaves manual_inputs for the deleted date in place — re-uploading that date silently inherits the old Kenyacof/Δ-Hedge pots; confirm with the desk whether that is intended (delete-snapshot tool does not touch COLLECTIONS.manualInputs)');
    } else fail(`manual_inputs docs after delete: ${manual.length} (expected 1 — they are not covered by deleteSnapshot)`);
    await saveSnapshot(D, { stock: P('s2') });
    const snap = await getSnapshot(D);
    eq('re-upload starts the date fresh (only the new input present)', Object.keys(canon(snap?.data)).sort(), ['positionDate', 'stock'].sort());
    eq('re-uploaded payload intact', snap?.data.stock, P('s2'));
  }

  // ---------- 13. Manual hedge inputs survive re-ingest ----------
  section(13, 'Manual pot inputs survive re-ingesting all three exports');
  {
    resetDb();
    const D = '2099-01-13';
    await setManualInputs(D, DEMO_MANUAL_INPUTS);
    const before = dump(COLLECTIONS.manualInputs, { positionDate: D });
    await saveSnapshot(D, { stock: P('s'), theoretical: DEMO_THEORETICAL });
    await saveSnapshot(D, { dnp: DEMO_DNP });
    await saveSnapshot(D, { sales: [pendingSale('QA-13')] });
    await saveSnapshot(D, { dnp: DEMO_DNP }); // and a re-ingest on top
    eq('manual_inputs byte-identical after re-ingest', dump(COLLECTIONS.manualInputs, { positionDate: D }), before);
    const res = await runComputeChain(D, { tool: 'compute-position' });
    if (res.hedge && res.hedge['Kenyacof futs']?.mt === DEMO_MANUAL_INPUTS.kenyacofFutsMt) ok('compute applies the surviving Kenyacof futs pot (-1717 MT)');
    else fail(`hedge lines missing/wrong after re-ingest: ${JSON.stringify(res.hedge?.['Kenyacof futs'])}`);
    if (!res.caveats.some((c: string) => /Manual pot inputs not set/.test(c))) ok('no missing-manual caveat');
    else fail('compute claims manual pots are missing although they survived');
  }

  // ---------- 14. Logistics re-upload changing the pending-blend set ----------
  section(14, 'Sales re-upload — does the pending-blend list drop departed sales?');
  {
    resetDb();
    const D = '2099-01-14';
    await saveSnapshot(D, { theoretical: DEMO_THEORETICAL, dnp: DEMO_DNP });
    await saveSnapshot(D, { sales: [pendingSale('QA-X'), pendingSale('QA-Y')] });
    await runComputeChain(D, { tool: 'compute-position' });
    const round1 = dump(COLLECTIONS.pendingBlends, { positionDate: D }).map((d) => d.data.saleCtr).sort();
    eq('both unknown sales pend after round 1', round1, ['QA-X', 'QA-Y']);
    // the re-upload: QA-X has left the book
    await saveSnapshot(D, { sales: [pendingSale('QA-Y')] });
    const res2 = await runComputeChain(D, { tool: 'compute-position' });
    const snapPending = ((await getSnapshot(D))?.data.pendingBlends ?? []).map((p: any) => p.saleCtr).sort();
    eq('snapshot pendingBlends key reflects the new book', snapPending, ['QA-Y']);
    eq('compute result reports only the live pending sale', res2.blendAssignment.pendingConfirmation.map((p: any) => p.saleCtr), ['QA-Y']);
    const round2 = dump(COLLECTIONS.pendingBlends, { positionDate: D }).map((d) => d.data.saleCtr).sort();
    eq('pending_blends collection refreshed — departed QA-X deleted (R3-F3)', round2, ['QA-Y']);
  }

  // ---------- 15. Legacy duplicate docs for the same key ----------
  section(15, 'Legacy duplicate docs — deterministic resolution');
  {
    resetDb();
    const D = '2099-01-15';
    // duplicate computed docs, inserted NEWEST-first to prove sorting, not luck
    await Data.create(COLLECTIONS.snapshots, { positionDate: D, theoretical: 'NEW', offers: 'NEW-ONLY', updatedAt: '2026-07-02T00:00:00Z' });
    await Data.create(COLLECTIONS.snapshots, { positionDate: D, theoretical: 'OLD', net: 'OLD-ONLY', updatedAt: '2026-07-01T00:00:00Z' });
    const snap = await getSnapshot(D);
    eq('mergeDocs: newest write wins per key', snap?.data.theoretical, 'NEW');
    eq('mergeDocs: keys only the older doc has survive', snap?.data.net, 'OLD-ONLY');
    eq('mergeDocs: keys only the newer doc has survive', snap?.data.offers, 'NEW-ONLY');
    // duplicate INPUT docs for one (date, kind) — the pre-fix race artifact
    resetDb();
    await Data.create(COLLECTIONS.snapshotInputs, { positionDate: D, kind: 'sales', payload: [P('NEWER')], updatedAt: '2026-07-02T00:00:00Z' });
    await Data.create(COLLECTIONS.snapshotInputs, { positionDate: D, kind: 'sales', payload: [P('OLDER')], updatedAt: '2026-07-01T00:00:00Z' });
    const assembled = (await getSnapshot(D))?.data.sales;
    if (JSON.stringify(assembled) === JSON.stringify([P('NEWER')])) ok('duplicate input docs resolve to the newest payload');
    else {
      ok(`characterized: duplicate input docs resolve by INSERTION order (got ${assembled?.[0]?.marker})`);
      finding('duplicate snapshot_inputs docs for one (positionDate, kind) resolve by collection insertion order, NOT updatedAt — getSnapshot (store.ts:109-113) assigns data[kind] per input doc in getAll order, unlike mergeDocs which sorts computed docs by updatedAt. If a pre-fix race left duplicates, which payload wins is storage-order luck.');
    }
  }

  // ---------- 16. Unicode / special characters ----------
  section(16, 'Unicode client & grade names survive parse → store → citation');
  {
    resetDb();
    const client = 'CAFÉ MÜNCHEN — 珈琲貿易 GmbH & Co. "Späti"';
    const grade = 'AA★ FAQ (ñandú)';
    const text = logiTsv([{ 'Sale Ctr.': 'U-1', Client: client, 'S.Grade': grade, SMT: 12, 'S.Ship.': '2099/03/01' }]);
    // utf-8, no BOM
    const salesU8 = aggregateSales(parseLogisticsReport(decodeExportText(new Uint8Array(Buffer.from(text, 'utf8')))));
    eq('utf-8: client survives the parser', salesU8[0]?.client, client);
    eq('utf-8: grade survives the parser', salesU8[0]?.sGrade, grade);
    // utf-16le with BOM — the DNP-style encoding
    const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    const salesU16 = aggregateSales(parseLogisticsReport(decodeExportText(new Uint8Array(u16))));
    eq('utf-16le+BOM: client survives decode + parse', salesU16[0]?.client, client);
    const D = '2099-01-16';
    await saveSnapshot(D, { sales: salesU8 });
    eq('round-trips through the store intact', (await getSnapshot(D))?.data.sales[0].client, client);
    const cite = citeLine({ tool: 'qa', positionDate: D, sources: [client] });
    if (cite.includes(client)) ok('citeLine renders the exact string');
    else fail(`citeLine mangled the name: ${cite}`);
  }

  // ---------- 17. Double-submit idempotency ----------
  section(17, 'Identical upload + compute twice — figures identical, nothing counted twice');
  {
    resetDb();
    const D = '2099-01-17';
    const book = [pendingSale('QA-17A'), { ...pendingSale('QA-17B'), month: '2099/04' }];
    const run = async () => {
      await saveSnapshot(D, { theoretical: DEMO_THEORETICAL, dnp: DEMO_DNP });
      await saveSnapshot(D, { sales: book });
      const r = await runComputeChain(D, { tool: 'compute-position' });
      return {
        total: r.total,
        byGradeCount: Object.keys(r.byGrade).length,
        pendingCount: r.blendAssignment.pendingConfirmation.length,
        salesStored: ((await getSnapshot(D))?.data.sales ?? []).length,
        pendingDocs: dump(COLLECTIONS.pendingBlends, { positionDate: D }).length,
        salesInputDocs: dump(COLLECTIONS.snapshotInputs, { positionDate: D, kind: 'sales' }).length,
      };
    };
    const first = await run();
    const second = await run();
    eq('all figures + doc counts identical across the double submit', second, first);
    eq('still one sales input doc', second.salesInputDocs, 1);
    eq('pending docs not duplicated', second.pendingDocs, first.pendingDocs);
  }

  console.log('');
  if (findings) console.log(`⚠ ${findings} product finding(s) flagged above — carry into the triage report.`);
  console.log(failures === 0 ? '✅ UPLOAD EDGE CASES PASSED' : `❌ ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
