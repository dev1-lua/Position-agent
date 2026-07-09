import { LuaSkill, LuaTool, Data } from 'lua-cli';
import { z } from 'zod';
import { UploadedFileSource } from '../sources/UploadedFileSource';
import { processInventoryLocation, processWarehouseStatus, processMatrixData, groupForecastRows } from '../lib/stockcounter';
import { COLLECTIONS, saveSnapshot, resolveFileId, defaultPositionDate, upsert, loadBatchMappings } from './store';
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
  .describe('Position date YYYY-MM-DD (defaults to today in Nairobi)');
const fileField = z.string().optional().describe('CDN file id of the upload (defaults to the most recent file in this chat)');

class IngestStockReport implements LuaTool {
  name = 'ingest-stock-report';
  description = 'Parse an uploaded XBS stock report (.xlsx) into the position snapshot (longs input).';
  inputSchema = z.object({ fileId: fileField, positionDate: dateField });

  async execute(input: { fileId?: string; positionDate?: string }) {
    const positionDate = input.positionDate ?? defaultPositionDate();
    const rows = await source.getStock(await resolveFileId(input.fileId));

    const today = new Date(`${positionDate}T00:00:00Z`);
    const location = processInventoryLocation(rows, today);
    const status = processWarehouseStatus(rows);
    const matrix = processMatrixData(rows);
    const groups = groupForecastRows(rows, await loadBatchMappings());

    // POST bags by raw strategy (consolidation happens at compute time)
    const postBags: Record<string, number> = {};
    for (const r of rows) {
      const strategy = String(r.strategy || '').trim();
      if (!strategy.toUpperCase().startsWith('POST')) continue;
      const qty = typeof r.qty === 'number' ? r.qty : parseFloat(String(r.qty));
      if (Number.isNaN(qty)) continue;
      postBags[strategy] = (postBags[strategy] || 0) + qty;
    }

    await saveSnapshot(positionDate, { stock: { location, status, matrix, postBags, groups, rowCount: rows.length } });
    return {
      positionDate,
      rowCount: rows.length,
      totalBags: Math.round(location.totals.bags),
      byStage: Object.fromEntries(status.map((s) => [s.key, Math.round(s.bags)])),
      matrixRows: matrix.length,
      nextStep: 'Run compute-theoretical-stock to get theoretical stock by POST grade.',
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
    return {
      positionDate,
      saleCount: sales.length,
      totalSmt: Math.round(totalSmt * 100) / 100,
      months: [...new Set(sales.map((s) => s.month))].sort(),
      nextStep: 'Run assign-blends to allocate each sale to a blend recipe.',
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
- Each export type has its own tool; ask which file is which if unclear (stock is .xlsx; the two SOL exports are .xls).
- All three write into the snapshot for the position date (default: today, Nairobi). Pass positionDate when the trader says the export is for another day.
- If the trader uploaded a file but no fileId is known, the tools automatically use the most recent upload in this chat.
- seed-reference-data is one-time setup (safe to re-run) — run it if blend/assumption lookups appear empty.
- list-snapshots shows what data exists per date. The usual flow after uploads: compute-theoretical-stock → assign-blends → compute-forward-sales → compute-net-position → compute-futs-spread.`,
  tools: [new IngestStockReport(), new IngestDailyNetPosition(), new IngestLogisticsReport(), new SeedReferenceData(), new ListSnapshots()],
});
