import { LuaSkill, LuaTool, Data } from 'lua-cli';
import { z } from 'zod';
import { UploadedFileSource } from '../sources/UploadedFileSource';
import { processInventoryLocation, processWarehouseStatus, processMatrixData, groupForecastRows } from '../lib/stockcounter';
import { computeStockCoverage } from '../lib/stockcoverage';
import { citeLine } from '../lib/cite';
import { xbsReportDate, dnpReportDate, resolvePositionDate } from '../lib/reportdate';
import { COLLECTIONS, saveSnapshot, deleteSnapshot, clearDemoSnapshot, resolveFileId, listSnapshotSummaries, upsert, loadBatchMappings, inputDocExists, logUpload, refuseEmptyIngest } from './store';
import {
  BLENDS_SEED,
  ASSUMPTIONS_SEED,
  STRATEGY_MAPPING_SEED,
  BATCH_MAPPINGS_SEED,
  ASSIGNMENT_HISTORY_SEED,
} from '../seed';

/**
 * Ingestion: turn the three uploaded exports into a compact snapshot for a
 * position date. Raw stock rows are NOT persisted — only the summaries the
 * downstream maths needs (status buckets, location summary, PRE/IN matrix,
 * POST bags by strategy, forecast groups).
 */

const source = new UploadedFileSource();

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe('Position date YYYY-MM-DD. XBS/DNP exports carry their own date in their rows — it is derived automatically and always wins; pass this only as a fallback. NEVER pass today\'s date just because none was mentioned.');
const logisticsDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe('Position date YYYY-MM-DD — REQUIRED in practice: this export carries no internal date. Use the data date derived for the XBS/DNP exports uploaded with it, or ask the trader which day the report was exported. NEVER pass today\'s date as a guess.');
const fileField = z.string().optional().describe('CDN file id of the upload (defaults to the most recent file in this chat)');

class IngestStockReport implements LuaTool {
  name = 'ingest-stock-report';
  description =
    'Parse an uploaded XBS Current Stock export (raw .csv or .xlsx) into the position snapshot (longs input). Returns an upload-time coverage report with drift warnings.';
  inputSchema = z.object({ fileId: fileField, positionDate: dateField });

  async execute(input: { fileId?: string; positionDate?: string }) {
    const fileId = await resolveFileId(input.fileId);
    const rows = await source.getStock(fileId);
    // the export's own date (Intake Date + Stock In Day(s), row-majority) always wins
    const dateRes = resolvePositionDate(xbsReportDate(rows), input.positionDate, 'XBS Current Stock export');
    const positionDate = dateRes.positionDate;
    await refuseEmptyIngest('XBS Current Stock export', 'stock', rows.length, positionDate);

    const today = new Date(`${positionDate}T00:00:00Z`);
    const location = processInventoryLocation(rows, today);
    const status = processWarehouseStatus(rows);
    const matrix = processMatrixData(rows);
    const groups = groupForecastRows(rows, await loadBatchMappings());
    const coverage = computeStockCoverage(rows);

    // POST bags by raw strategy (consolidation happens at compute time)
    const postBags: Record<string, number> = {};
    for (const r of rows) {
      const strategy = String(r.strategy || '').trim();
      if (!strategy.toUpperCase().startsWith('POST')) continue;
      const qty = typeof r.qty === 'number' ? r.qty : parseFloat(String(r.qty));
      if (Number.isNaN(qty)) continue;
      postBags[strategy] = (postBags[strategy] || 0) + qty;
    }

    // coverage rides the snapshot so blocked/crop-year/cert analytics work
    // later without the raw rows (absent on snapshots ingested before this)
    const clearedDemo = await clearDemoSnapshot(positionDate);
    const overwrote = await inputDocExists(positionDate, 'stock');
    await saveSnapshot(positionDate, {
      stock: { location, status, matrix, postBags, groups, rowCount: rows.length, coverage },
    });
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const rollup = (b: { rows: number; bags: number }) => ({ rows: b.rows, bags: r2(b.bags) });
    const coverageReport = {
      blocked: rollup(coverage.blocked),
      workInProgressNoWarehouse: rollup(coverage.wip),
      byCropYear: Object.fromEntries(Object.entries(coverage.byCropYear).map(([k, b]) => [k, rollup(b)])),
      certTagged: { ...rollup(coverage.certTagged), tags: Object.keys(coverage.certTagged.tags) },
      intakeDates: coverage.intakeDates,
      pendingStrategyTags: Object.fromEntries(Object.entries(coverage.pendingTags).map(([k, b]) => [k, rollup(b)])),
      unclassifiedBlankStrategy: rollup(coverage.unclassified),
      extraPostGrades: coverage.extraPostGrades,
    };
    const warnings = [...dateRes.warnings, ...coverage.warnings];
    await logUpload({
      at: new Date().toISOString(),
      kind: 'stock',
      positionDate,
      fileId,
      rowCount: rows.length,
      dateSource: dateRes.dateSource,
      warnings,
      overwrote,
      coverage: coverageReport,
    });
    return {
      positionDate,
      dateSource: dateRes.dateSource,
      rowCount: rows.length,
      totalBags: Math.round(location.totals.bags),
      byStage: Object.fromEntries(status.map((s) => [s.key, Math.round(s.bags)])),
      matrixRows: matrix.length,
      coverage: coverageReport,
      warnings,
      ...(clearedDemo
        ? { note: `The demo-seeded snapshot for ${positionDate} was CLEARED — this date now starts fresh from your real upload; re-run the compute chain.` }
        : {}),
      nextStep: 'Run compute-theoretical-stock to get theoretical stock by POST grade.',
      cite: citeLine({ tool: this.name, positionDate, sources: ['uploaded XBS Current Stock export'] }),
    };
  }
}

class IngestDailyNetPosition implements LuaTool {
  name = 'ingest-daily-net-position';
  description = 'Parse an uploaded SOL DailyNetPosition export into the position snapshot (hedge maths input).';
  inputSchema = z.object({ fileId: fileField, positionDate: dateField });

  async execute(input: { fileId?: string; positionDate?: string }) {
    const fileId = await resolveFileId(input.fileId);
    const dnp = await source.getDailyNetPosition(fileId);
    // the export's own date (DatePos column, row-majority) always wins
    const dateRes = resolvePositionDate(dnpReportDate(dnp), input.positionDate, 'SOL DailyNetPosition export');
    const positionDate = dateRes.positionDate;
    await refuseEmptyIngest('SOL DailyNetPosition export', 'dnp', dnp.length, positionDate);
    const clearedDemo = await clearDemoSnapshot(positionDate);
    const overwrote = await inputDocExists(positionDate, 'dnp');
    await saveSnapshot(positionDate, { dnp });
    await logUpload({
      at: new Date().toISOString(),
      kind: 'dnp',
      positionDate,
      fileId,
      rowCount: dnp.length,
      dateSource: dateRes.dateSource,
      warnings: dateRes.warnings,
      overwrote,
    });
    return {
      positionDate,
      dateSource: dateRes.dateSource,
      rowCount: dnp.length,
      hedgeableRows: dnp.filter((r) => r.quality.toUpperCase() === 'HEDGEABLE').length,
      ...(dateRes.warnings.length ? { warnings: dateRes.warnings } : {}),
      ...(clearedDemo
        ? { note: `The demo-seeded snapshot for ${positionDate} was CLEARED — this date now starts fresh from your real upload.` }
        : {}),
      nextStep: 'Run compute-futs-spread once theoretical stock and forward sales are computed.',
      cite: citeLine({ tool: this.name, positionDate, sources: ['uploaded SOL DailyNetPosition export'] }),
    };
  }
}

class IngestLogisticsReport implements LuaTool {
  name = 'ingest-logistics-report';
  description = 'Parse an uploaded SOL ReportLogistic export (unallocated sales = shorts) into the position snapshot.';
  inputSchema = z.object({ fileId: fileField, positionDate: logisticsDateField });

  async execute(input: { fileId?: string; positionDate?: string }) {
    // the ReportLogistic export carries NO report date in its rows (verified
    // column-by-column) — a date must be supplied; guessing "today" is exactly
    // the inaccuracy this refuses to allow.
    const dateRes = resolvePositionDate({ date: null, agree: 0, total: 0 }, input.positionDate, 'SOL ReportLogistic export');
    const positionDate = dateRes.positionDate;
    const fileId = await resolveFileId(input.fileId);
    const sales = await source.getLogistics(fileId);
    await refuseEmptyIngest('SOL ReportLogistic export', 'sales', sales.length, positionDate);
    const clearedDemo = await clearDemoSnapshot(positionDate);
    const overwrote = await inputDocExists(positionDate, 'sales');
    await saveSnapshot(positionDate, { sales });
    const totalSmt = sales.reduce((s, x) => s + x.smt, 0);
    // coverage report: surfaces export-format drift (missing difs, odd price
    // units, no bookings) at upload time instead of silently thinner answers
    const knownUnits = new Set(['USC/LB', 'USD/KG', 'USD/MT']);
    const oddUnits = [...new Set(sales.map((s) => s.sPriceUnit).filter((u): u is string => !!u && !knownUnits.has(u.toUpperCase())))];
    const withDif = sales.filter((s) => s.sDif != null).length;
    const coverageReport = {
      pricedSales: withDif,
      unpricedSales: sales.length - withDif,
      bookedContracts: sales.filter((s) => s.booking?.preshipId != null).length,
      vesselAssigned: sales.filter((s) => s.booking?.vessel != null).length,
      ...(oddUnits.length ? { unknownPriceUnits: oddUnits } : {}),
    };
    const warnings = [
      ...(withDif < sales.length ? [`${sales.length - withDif} sale(s) have no differential — price analytics will exclude them.`] : []),
      ...(oddUnits.length ? [`Unknown price unit(s) ${oddUnits.join(', ')} — flat-price averages will skip those sales.`] : []),
    ];
    await logUpload({
      at: new Date().toISOString(),
      kind: 'sales',
      positionDate,
      fileId,
      rowCount: sales.length,
      dateSource: dateRes.dateSource,
      warnings: [...dateRes.warnings, ...warnings],
      overwrote,
      coverage: coverageReport,
    });
    return {
      positionDate,
      dateSource: dateRes.dateSource,
      saleCount: sales.length,
      totalSmt: Math.round(totalSmt * 100) / 100,
      months: [...new Set(sales.map((s) => s.month))].sort(),
      coverage: coverageReport,
      warnings,
      ...(clearedDemo
        ? { note: `The demo-seeded snapshot for ${positionDate} was CLEARED — this date now starts fresh from your real upload.` }
        : {}),
      nextStep: 'Run assign-blends to allocate each sale to a blend recipe.',
      cite: citeLine({ tool: this.name, positionDate, sources: ['uploaded SOL ReportLogistic export'] }),
    };
  }
}

class SeedReferenceData implements LuaTool {
  name = 'seed-reference-data';
  description =
    'One-time setup: seed the Data collections (blends, assumptions, strategy/batch mappings, blend-assignment history, config) from the bundled workbook extracts. Idempotent.';
  inputSchema = z.object({});

  async execute() {
    let blends = 0;
    for (const b of BLENDS_SEED.blends as any[]) {
      if (b.blendNo == null) continue;
      await upsert(COLLECTIONS.blends, { blendNo: b.blendNo }, b, `blend ${b.blendNo} ${b.client ?? ''} ${b.grade ?? ''}`);
      blends++;
    }
    let assumptions = 0;
    for (const [key, a] of Object.entries(ASSUMPTIONS_SEED.ASSUMPTIONS as Record<string, any>)) {
      await upsert(COLLECTIONS.assumptions, { key }, { key, ...a }, `assumption ${key}`);
      assumptions++;
    }
    for (const [standard, raws] of Object.entries(STRATEGY_MAPPING_SEED)) {
      await upsert(COLLECTIONS.strategyMappings, { standard }, { standard, raws });
    }
    for (const [batchId, standard] of Object.entries(BATCH_MAPPINGS_SEED)) {
      await upsert(COLLECTIONS.batchMappings, { batchId }, { batchId, standard });
    }
    // learned blend memory from the golden-day BASE FILE
    const counts: Record<string, Record<number, number>> = {};
    for (const s of ASSIGNMENT_HISTORY_SEED as any[]) {
      const key = [s.client ?? '', s.sGrade ?? '', s.sStrategy ?? '']
        .map((x: any) => String(x).toUpperCase().replace(/\s+/g, ' ').trim())
        .join('|');
      (counts[key] ||= {})[s.blendNo] = (counts[key][s.blendNo] || 0) + 1;
    }
    for (const [key, c] of Object.entries(counts)) {
      await upsert(COLLECTIONS.blendAssignments, { key }, { key, counts: c }, `blend assignment ${key}`);
    }
    await upsert(COLLECTIONS.config, { key: 'engine' }, {
      key: 'engine',
      kgPerBag: 60,
      mtPerBag: 0.06,
      mtPerLot: 17.01,
      netHorizonMonths: 10, // workbook Summary E:N rule
    });
    return { blends, assumptions, assignmentKeys: Object.keys(counts).length, status: 'seeded' };
  }
}

// load-demo-snapshot was REMOVED 2026-07-10 at the desk's request: production
// must hold nothing but real uploads — no loadable demo data at all. The
// 2026-06-18 validation seeds stay in src/seed/demo.ts for the parity
// harness only; they are no longer reachable from any deployed tool. The
// `demo` flag handling (clearDemoSnapshot, demo:false on ingest) is kept as
// protection against any demo-flagged snapshot that may still exist in a
// store.

class DeleteSnapshot implements LuaTool {
  name = 'delete-snapshot';
  description =
    'Permanently remove one stored position snapshot (a demo/test day or a bad upload) and its pending blend confirmations. Irreversible — only call after the trader has explicitly confirmed the exact date.';
  inputSchema = z.object({
    positionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The snapshot date to delete (confirm with the trader first)'),
  });

  async execute(input: { positionDate: string }) {
    const deleted = await deleteSnapshot(input.positionDate);
    // pending blend confirmations for that date are meaningless without it
    const pend = await Data.get(COLLECTIONS.pendingBlends, { positionDate: input.positionDate }, 1, 100);
    for (const p of pend?.data ?? []) if (p?.id) await Data.delete(COLLECTIONS.pendingBlends, p.id);
    const remaining = await listSnapshotSummaries();
    return {
      positionDate: input.positionDate,
      deleted,
      pendingBlendsRemoved: (pend?.data ?? []).length,
      remainingSnapshots: remaining.map((r) => r.positionDate).sort(),
      ...(deleted ? {} : { note: 'No snapshot existed for that date — nothing was deleted.' }),
    };
  }
}

class ListSnapshots implements LuaTool {
  name = 'list-snapshots';
  description = 'List stored position snapshots (date + which inputs/results are present).';
  inputSchema = z.object({});

  async execute() {
    return listSnapshotSummaries();
  }
}

export const ingestionSkill = new LuaSkill({
  name: 'position-ingestion',
  description: 'Ingest the three desk exports (XBS stock, SOL DailyNetPosition, SOL ReportLogistic) into daily position snapshots.',
  context: `Use these tools when the trader uploads position exports.
- Uploaded spreadsheets arrive as a "[Spreadsheet received and stored: fileId=…]" manifest (a preprocessor stores the raw file on the CDN and detects the export type). Pass that fileId to the ingest tool the manifest names. If it says the file was not recognized, ask the trader what it is instead of guessing.
- Each export type has its own tool; ask which file is which if unclear (stock is the XBS "Current Stock" export, raw .csv or .xlsx; the two SOL exports are .xls).
- ingest-stock-report returns a coverage report: blocked stock, WIP lots (no warehouse), crop years, XBS cert tags, and unbucketed strategy tags ALL COUNT toward the total (validated against the 2026-06-18 golden day). Relay any warnings to the trader verbatim — they signal export-format drift.
- POSITION DATE (accuracy is a hard rule): the XBS and DNP exports carry their own report date in their rows — the ingest tools derive it automatically and it ALWAYS wins, even over a date the trader states. The ReportLogistic export carries NO internal date: you MUST pass positionDate — use the data date the XBS/DNP manifests/results show for the same upload batch, or ask the trader which day the report was exported. NEVER pass today's date as a guess; if you truly cannot determine it, ask. Relay each tool's dateSource and any date warnings to the trader.
- Uploading all three files in one message is safe — each ingest writes its own record; they cannot overwrite each other.
- If the trader uploaded a file but no fileId is known, the tools automatically use the most recent upload in this chat.
- seed-reference-data is one-time setup (safe to re-run) — run it if blend/assumption lookups appear empty.
- There is NO demo/sample data: every answer comes from what the trader uploaded. If someone asks for demo data, say the system only works on real uploaded exports.
- delete-snapshot permanently removes one date (test days, bad uploads). Irreversible: confirm the exact date with the trader before calling; use list-snapshots to show what exists.
- list-snapshots shows what data exists per date. After uploads: run compute-theoretical-stock (stock), then compute-position does everything else in one call.`,
  tools: [new IngestStockReport(), new IngestDailyNetPosition(), new IngestLogisticsReport(), new SeedReferenceData(), new DeleteSnapshot(), new ListSnapshots()],
});
