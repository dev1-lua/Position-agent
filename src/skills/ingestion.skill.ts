import { LuaSkill, LuaTool, Data } from 'lua-cli';
import { z } from 'zod';
import { UploadedFileSource } from '../sources/UploadedFileSource';
import { processInventoryLocation, processWarehouseStatus, processMatrixData, groupForecastRows } from '../lib/stockcounter';
import { computeStockCoverage } from '../lib/stockcoverage';
import { citeLine } from '../lib/cite';
import { COLLECTIONS, saveSnapshot, resolveFileId, defaultPositionDate, upsert, loadBatchMappings } from './store';
import {
  BLENDS_SEED,
  ASSUMPTIONS_SEED,
  STRATEGY_MAPPING_SEED,
  BATCH_MAPPINGS_SEED,
  ASSIGNMENT_HISTORY_SEED,
} from '../seed';
import { DEMO_POSITION_DATE, DEMO_SALES, DEMO_DNP, DEMO_THEORETICAL, DEMO_STOCK, DEMO_MANUAL_INPUTS } from '../seed/demo';

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
  .describe('Position date YYYY-MM-DD (defaults to today in Nairobi)');
const fileField = z.string().optional().describe('CDN file id of the upload (defaults to the most recent file in this chat)');

class IngestStockReport implements LuaTool {
  name = 'ingest-stock-report';
  description =
    'Parse an uploaded XBS Current Stock export (raw .csv or .xlsx) into the position snapshot (longs input). Returns an upload-time coverage report with drift warnings.';
  inputSchema = z.object({ fileId: fileField, positionDate: dateField });

  async execute(input: { fileId?: string; positionDate?: string }) {
    const positionDate = input.positionDate ?? defaultPositionDate();
    const rows = await source.getStock(await resolveFileId(input.fileId));

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
    await saveSnapshot(positionDate, {
      stock: { location, status, matrix, postBags, groups, rowCount: rows.length, coverage },
    });
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const rollup = (b: { rows: number; bags: number }) => ({ rows: b.rows, bags: r2(b.bags) });
    return {
      positionDate,
      rowCount: rows.length,
      totalBags: Math.round(location.totals.bags),
      byStage: Object.fromEntries(status.map((s) => [s.key, Math.round(s.bags)])),
      matrixRows: matrix.length,
      coverage: {
        blocked: rollup(coverage.blocked),
        workInProgressNoWarehouse: rollup(coverage.wip),
        byCropYear: Object.fromEntries(Object.entries(coverage.byCropYear).map(([k, b]) => [k, rollup(b)])),
        certTagged: { ...rollup(coverage.certTagged), tags: Object.keys(coverage.certTagged.tags) },
        intakeDates: coverage.intakeDates,
        pendingStrategyTags: Object.fromEntries(Object.entries(coverage.pendingTags).map(([k, b]) => [k, rollup(b)])),
        unclassifiedBlankStrategy: rollup(coverage.unclassified),
        extraPostGrades: coverage.extraPostGrades,
      },
      warnings: coverage.warnings,
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
    const positionDate = input.positionDate ?? defaultPositionDate();
    const dnp = await source.getDailyNetPosition(await resolveFileId(input.fileId));
    await saveSnapshot(positionDate, { dnp });
    return {
      positionDate,
      rowCount: dnp.length,
      hedgeableRows: dnp.filter((r) => r.quality.toUpperCase() === 'HEDGEABLE').length,
      nextStep: 'Run compute-futs-spread once theoretical stock and forward sales are computed.',
      cite: citeLine({ tool: this.name, positionDate, sources: ['uploaded SOL DailyNetPosition export'] }),
    };
  }
}

class IngestLogisticsReport implements LuaTool {
  name = 'ingest-logistics-report';
  description = 'Parse an uploaded SOL ReportLogistic export (unallocated sales = shorts) into the position snapshot.';
  inputSchema = z.object({ fileId: fileField, positionDate: dateField });

  async execute(input: { fileId?: string; positionDate?: string }) {
    const positionDate = input.positionDate ?? defaultPositionDate();
    const sales = await source.getLogistics(await resolveFileId(input.fileId));
    await saveSnapshot(positionDate, { sales });
    const totalSmt = sales.reduce((s, x) => s + x.smt, 0);
    // coverage report: surfaces export-format drift (missing difs, odd price
    // units, no bookings) at upload time instead of silently thinner answers
    const knownUnits = new Set(['USC/LB', 'USD/KG', 'USD/MT']);
    const oddUnits = [...new Set(sales.map((s) => s.sPriceUnit).filter((u): u is string => !!u && !knownUnits.has(u.toUpperCase())))];
    const withDif = sales.filter((s) => s.sDif != null).length;
    return {
      positionDate,
      saleCount: sales.length,
      totalSmt: Math.round(totalSmt * 100) / 100,
      months: [...new Set(sales.map((s) => s.month))].sort(),
      coverage: {
        pricedSales: withDif,
        unpricedSales: sales.length - withDif,
        bookedContracts: sales.filter((s) => s.booking?.preshipId != null).length,
        vesselAssigned: sales.filter((s) => s.booking?.vessel != null).length,
        ...(oddUnits.length ? { unknownPriceUnits: oddUnits } : {}),
      },
      warnings: [
        ...(withDif < sales.length ? [`${sales.length - withDif} sale(s) have no differential — price analytics will exclude them.`] : []),
        ...(oddUnits.length ? [`Unknown price unit(s) ${oddUnits.join(', ')} — flat-price averages will skip those sales.`] : []),
      ],
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

class LoadDemoSnapshot implements LuaTool {
  name = 'load-demo-snapshot';
  description =
    'Load the bundled demo/validation day (2026-06-18, the golden workbook day): 60 sales, the real DailyNetPosition, theoretical stock, and the manual pot figures. For demos and end-to-end verification — no uploads needed.';
  inputSchema = z.object({});

  async execute() {
    await saveSnapshot(DEMO_POSITION_DATE, {
      demo: true,
      sales: DEMO_SALES,
      dnp: DEMO_DNP,
      theoretical: DEMO_THEORETICAL,
      stock: DEMO_STOCK,
    });
    await upsert(COLLECTIONS.manualInputs, { positionDate: DEMO_POSITION_DATE }, {
      positionDate: DEMO_POSITION_DATE,
      ...DEMO_MANUAL_INPUTS,
    });
    return {
      positionDate: DEMO_POSITION_DATE,
      loaded: {
        sales: DEMO_SALES.length,
        dnpRows: DEMO_DNP.length,
        theoreticalTotalBags: DEMO_THEORETICAL.totals.total,
        stockRows: DEMO_STOCK.rowCount,
      },
      manualInputs: DEMO_MANUAL_INPUTS,
      note: 'Demo day loaded (theoretical stock is pre-computed; the stock summaries come from the real 2026-06-18 XBS export, so stock-analytics works). Next: assign-blends → compute-forward-sales → compute-net-position → compute-futs-spread. Expected net ≈ −4,850 bags.',
      cite: citeLine({ tool: this.name, positionDate: DEMO_POSITION_DATE, demo: true, sources: ['bundled demo seed (real 2026-06-18 desk exports)'] }),
    };
  }
}

class ListSnapshots implements LuaTool {
  name = 'list-snapshots';
  description = 'List stored position snapshots (date + which inputs/results are present).';
  inputSchema = z.object({});

  async execute() {
    const res = await Data.get(COLLECTIONS.snapshots, undefined, 1, 50);
    return (res?.data ?? [])
      .map((r: any) => {
        const d = r.data ?? {};
        return {
          positionDate: d.positionDate,
          has: {
            stock: !!d.stock,
            dailyNetPosition: !!d.dnp,
            sales: !!d.sales,
            theoretical: !!d.theoretical,
            forwardSales: !!d.forwardSales,
            netPosition: !!d.net,
            futsSpread: !!d.futs,
          },
          updatedAt: d.updatedAt,
        };
      })
      .sort((a: any, b: any) => String(b.positionDate).localeCompare(String(a.positionDate)));
  }
}

export const ingestionSkill = new LuaSkill({
  name: 'position-ingestion',
  description: 'Ingest the three desk exports (XBS stock, SOL DailyNetPosition, SOL ReportLogistic) into daily position snapshots.',
  context: `Use these tools when the trader uploads position exports.
- Uploaded spreadsheets arrive as a "[Spreadsheet received and stored: fileId=…]" manifest (a preprocessor stores the raw file on the CDN and detects the export type). Pass that fileId to the ingest tool the manifest names. If it says the file was not recognized, ask the trader what it is instead of guessing.
- Each export type has its own tool; ask which file is which if unclear (stock is the XBS "Current Stock" export, raw .csv or .xlsx; the two SOL exports are .xls).
- ingest-stock-report returns a coverage report: blocked stock, WIP lots (no warehouse), crop years, XBS cert tags, and unbucketed strategy tags ALL COUNT toward the total (validated against the 2026-06-18 golden day). Relay any warnings to the trader verbatim — they signal export-format drift.
- All three write into the snapshot for the position date (default: today, Nairobi). Pass positionDate when the trader says the export is for another day.
- If the trader uploaded a file but no fileId is known, the tools automatically use the most recent upload in this chat.
- seed-reference-data is one-time setup (safe to re-run) — run it if blend/assumption lookups appear empty.
- load-demo-snapshot loads the bundled 2026-06-18 validation day (no uploads needed) — use it for demos or when someone wants to try the agent before real data exists. Always tell the user the data is the demo day, not live.
- list-snapshots shows what data exists per date. The usual flow after uploads: compute-theoretical-stock → assign-blends → compute-forward-sales → compute-net-position → compute-futs-spread.`,
  tools: [new IngestStockReport(), new IngestDailyNetPosition(), new IngestLogisticsReport(), new SeedReferenceData(), new LoadDemoSnapshot(), new ListSnapshots()],
});
