import { LuaSkill, LuaTool } from 'lua-cli';
import { z } from 'zod';
import {
  calculateTheoreticalStock,
  derivePercentagesFromGroups,
  theoreticalByGrade,
  Percentages,
  POST_ORDER,
} from '../lib/stockcounter';
import { StockRow } from '../lib/types';
import { round } from '../lib/units';
import {
  COLLECTIONS,
  getSnapshot,
  saveSnapshot,
  upsert,
  loadAssumptions,
  loadStrategyMapping,
  loadForecastOverrides,
} from './store';

/**
 * Longs: theoretical stock by POST grade from the ingested stock summary.
 * Percentages come from saved assumptions (auto-derived) overlaid with the
 * trader's per-row overrides; rows neither source covers are reported as
 * unresolved for the trader to fill via set-forecast-percentages.
 */

class ComputeTheoreticalStock implements LuaTool {
  name = 'compute-theoretical-stock';
  description =
    'Compute theoretical stock by POST grade (longs) from the ingested XBS stock report, applying yield assumptions + trader overrides.';
  inputSchema = z.object({
    positionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Defaults to the latest snapshot'),
  });

  async execute(input: { positionDate?: string }) {
    const snap = await getSnapshot(input.positionDate);
    if (!snap?.data?.stock) throw new Error('No ingested stock report found — run ingest-stock-report first.');
    const { status, matrix, postBags, groups } = snap.data.stock;

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
    const unresolved = derived.unresolved.filter(
      (u) => u.reason !== 'ambiguous-outputs' ? !covered.has(u.rowKey) : !overrides[u.rowKey]
    );

    // POST rows were summarised at ingest; rebuild pseudo-rows for the engine's POST scan.
    const postRows: StockRow[] = Object.entries(postBags ?? {}).map(([strategy, kgs]) => ({
      strategy,
      qty: Number(kgs),
    }));
    const theoretical = calculateTheoreticalStock(postRows, matrix, status, percentages);

    await saveSnapshot(snap.data.positionDate, {
      theoretical: {
        grades: theoretical.grades,
        order: theoretical.order,
        grandTotalFinished: theoretical.grandTotalFinished,
        unclassifiedBags: theoretical.unclassifiedBags,
        totals: theoretical.totals,
        byGrade: theoreticalByGrade(theoretical),
      },
      percentagesUsed: percentages,
      unresolvedForecastRows: unresolved,
    });

    return {
      positionDate: snap.data.positionDate,
      totalTheoreticalBags: round(theoretical.totals.total),
      byGrade: Object.fromEntries(
        theoretical.order.filter((g) => theoretical.grades[g].total !== 0).map((g) => [g, round(theoretical.grades[g].total)])
      ),
      finishedBags: round(theoretical.grandTotalFinished),
      unclassifiedBags: round(theoretical.unclassifiedBags),
      unresolvedRows: unresolved.map((u) => ({ row: u.rowKey, why: u.detail })),
      note: unresolved.length
        ? 'Some PRE/IN rows lack yield percentages — totals exclude their expected output until the trader sets them via set-forecast-percentages.'
        : undefined,
    };
  }
}

class SetForecastPercentages implements LuaTool {
  name = 'set-forecast-percentages';
  description =
    'Set/override the processing-yield percentages for one PRE/IN matrix row (whole numbers, e.g. {"POST 17 UP TOP": 99, "POST REJECTS S": 1}). Persists across days.';
  inputSchema = z.object({
    rowKey: z.string().describe('Matrix row key "STRATEGY|BATCH_PREFIX", e.g. "PRE AA - TOP|BA"'),
    percentages: z.record(z.string(), z.number().min(0).max(100)).describe('POST grade → percent (should sum to ~100)'),
  });

  async execute(input: { rowKey: string; percentages: Record<string, number> }) {
    const badGrades = Object.keys(input.percentages).filter((g) => !POST_ORDER.includes(g));
    const sum = Object.values(input.percentages).reduce((s, v) => s + v, 0);
    await upsert(COLLECTIONS.forecastPercentages, { rowKey: input.rowKey }, {
      rowKey: input.rowKey,
      percentages: input.percentages,
    });
    return {
      rowKey: input.rowKey,
      sum,
      warnings: [
        ...(Math.abs(sum - 100) > 0.01 ? [`Percentages sum to ${sum}, not 100`] : []),
        ...(badGrades.length ? [`Unknown POST grades: ${badGrades.join(', ')}`] : []),
      ],
      note: 'Re-run compute-theoretical-stock to apply.',
    };
  }
}

export const stockcounterSkill = new LuaSkill({
  name: 'position-stockcounter',
  description: 'Theoretical stock by POST grade (longs) — the stock-counter maths over the ingested XBS report.',
  context: `Longs side of the position.
- compute-theoretical-stock replicates the desk's stock-counter: already-in-POST bags + expected output from PRE/IN lots × yield percentages. Percentages are auto-derived from saved assumptions where unambiguous; anything else is listed as an unresolved row.
- When rows are unresolved, show them to the trader and record their answer with set-forecast-percentages (persists — the same row won't ask again).
- Report bags rounded to whole numbers; offer the already-in-POST vs expected split on request.`,
  tools: [new ComputeTheoreticalStock(), new SetForecastPercentages()],
});
