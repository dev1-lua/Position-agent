import { StockRow } from './types';

/**
 * Longs engine — theoretical stock by POST grade.
 *
 * Faithful port of Ivo's browser stock counter
 * (`forecast-context/new_stockcounter.html`): parse XBS stock rows →
 * location summary, processing-status buckets (PRE/IN/POST/FINISHED/
 * PENDING/UNCLASSIFIED), the PRE/IN processing matrix, and — applying
 * yield percentages per (input strategy | batch prefix) — the Total
 * Theoretical Stock per POST grade that feeds `Summary!C`.
 *
 * Port quirks kept intentionally (workbook parity):
 *  - `processMatrixData` filters on case-SENSITIVE `PRE`/`IN` prefixes,
 *    while status buckets and the POST scan are case-insensitive.
 *  - RECOVERABLE strategies get the item name appended so different
 *    recoverable streams stay separate matrix rows.
 *  - Batch prefix is literally `String(batchId || 'N/A').substring(0, 2)`
 *    uppercased ('N/A' → 'N/').
 *  - `consolidationMap` folds POST FAQ MINUS / POST FAQ PLUS into
 *    POST 17 UP FAQ before both the already-in-POST scan and the forecast.
 *  - Grades outside `POST_ORDER` (e.g. `POST SPECIALTY WASHED` in newer
 *    counter versions) still count toward totals; we additionally expose
 *    them per-grade rather than hiding them like the HTML render did.
 */

/** PRE/IN input strategies in the counter's display order. */
export const PRE_IN_ORDER = [
  'PRE AA - FAQ', 'PRE AA - FAQ MINUS', 'PRE AA - PLUS', 'PRE AA - TOP',
  'PRE AB - FAQ', 'PRE AB - FAQ MINUS', 'PRE AB - PLUS', 'PRE AB - TOP',
  'PRE ABC - FAQ', 'PRE ABC - PLUS', 'PRE AA - FAQ PLUS', 'PRE AB - FAQ PLUS',
  'PRE GRINDER BOLD', 'PRE GRINDER LIGHT', 'PRE MBUNIS', 'PRE PB - FAQ',
  'PRE PB - PLUS', 'PRE PB-TOP', 'PRE REJECT', 'PRE SPECIALTY - NATURAL',
  'PRE SPECIALTY - WASHED', 'PRE RECOVERABLES',
  'IN AA - FAQ', 'IN AA - FAQ MINUS', 'IN AA - PLUS', 'IN AA - TOP',
  'IN AB - FAQ', 'IN AB - FAQ MINUS', 'IN AB - PLUS', 'IN AB - TOP',
  'IN ABC - FAQ', 'IN ABC - PLUS', 'IN AA - FAQ PLUS', 'IN AB - FAQ PLUS',
  'IN GRINDER BOLD', 'IN GRINDER LIGHT', 'IN MBUNIS', 'IN PB - FAQ',
  'IN PB - PLUS', 'IN PB-TOP', 'IN REJECT', 'IN SPECIALTY - NATURAL',
  'IN SPECIALTY - WASHED',
];

/** POST output grades in the counter's display order. */
export const POST_ORDER = [
  'POST NATURAL',
  'POST 17 UP TOP', 'POST 16 TOP', 'POST 15 TOP', 'POST PB - TOP',
  'POST 17 UP PLUS', 'POST 16 PLUS', 'POST 15 PLUS', 'POST 14 PLUS', 'POST PB - PLUS',
  'POST 17 UP FAQ', 'POST 16 FAQ', 'POST 15 FAQ', 'POST 14 FAQ', 'POST PB - FAQ',
  'POST GRINDER BOLD', 'POST GRINDER LIGHT', 'POST MH', 'POST ML',
  'POST REJECTS S', 'POST REJECTS P',
];

/** POST grades folded into another before aggregation. */
export const CONSOLIDATION_MAP: Record<string, string> = {
  'POST FAQ MINUS': 'POST 17 UP FAQ',
  'POST FAQ PLUS': 'POST 17 UP FAQ',
};

export type StageKey = 'PRE' | 'IN' | 'POST' | 'FINISHED' | 'PENDING' | 'UNCLASSIFIED';

const STAGE_LABELS: Record<StageKey, string> = {
  PRE: 'Pre Processing',
  IN: 'In Processing',
  POST: 'Post-Processing',
  FINISHED: 'FINISHED',
  PENDING: 'Pending Inbound processing alignment',
  UNCLASSIFIED: 'Unclassified',
};

export interface LocationRow {
  location: string;
  originalName: string;
  kgs: number;
  bags: number;
  avgDays: number;
  percentOfTotal: number;
}

export interface LocationSummary {
  results: LocationRow[];
  totals: { bags: number; avgDays: number };
}

export interface StatusRow {
  stage: string;
  key: StageKey;
  bags: number;
  percentOfTotal: number;
}

export interface MatrixRow {
  strategy: string;
  batchPrefix: string;
  totalKgs: number;
}

/** rowKey (`strategy|batchPrefix`) → POST grade → percent as a whole number (95 = 95%). */
export type Percentages = Record<string, Record<string, number>>;

export interface TheoreticalStockResult {
  /** Per POST grade (POST_ORDER first, then any extra grades encountered). */
  grades: Record<string, { alreadyInPost: number; expected: number; total: number }>;
  /** Display order for `grades`. */
  order: string[];
  grandTotalFinished: number;
  unclassifiedBags: number;
  totals: { alreadyInPost: number; expected: number; total: number };
}

const qtyOf = (row: StockRow): number => {
  const q = typeof row.qty === 'number' ? row.qty : parseFloat(String(row.qty));
  return Number.isNaN(q) ? NaN : q;
};

/** Warehouse location summary: bags + intake-age per warehouse (port of `processInventoryLocation`). */
export function processInventoryLocation(rows: StockRow[], today: Date): LocationSummary {
  const locations: Record<string, { totalKgs: number; totalWeight: number }> = {};
  let grandTotalKgs = 0;
  let grandTotalWeight = 0;

  for (const row of rows) {
    const warehouse = row.warehouse ? String(row.warehouse).trim() : 'NO WAREHOUSE';
    const qty = qtyOf(row);
    if (Number.isNaN(qty)) continue;
    (locations[warehouse] ||= { totalKgs: 0, totalWeight: 0 }).totalKgs += qty;
    const intake = row.intakeDate;
    if (intake instanceof Date && !Number.isNaN(intake.getTime())) {
      const ageInDays = (today.getTime() - intake.getTime()) / (1000 * 3600 * 24);
      locations[warehouse].totalWeight += ageInDays * qty;
    }
  }
  for (const loc of Object.values(locations)) {
    grandTotalKgs += loc.totalKgs;
    grandTotalWeight += loc.totalWeight;
  }

  const results: LocationRow[] = Object.keys(locations).map((name) => {
    const { totalKgs, totalWeight } = locations[name];
    const displayName =
      name === 'KAHAWA BORA WAREHOUSE' ? 'In Our Warehouse'
      : name === 'NO WAREHOUSE' ? 'No Warehouse Assigned'
      : `Pending Arrival (${name})`;
    return {
      location: displayName,
      originalName: name,
      kgs: totalKgs,
      bags: totalKgs / 60,
      avgDays: totalKgs > 0 ? totalWeight / totalKgs : 0,
      percentOfTotal: grandTotalKgs > 0 ? (totalKgs / grandTotalKgs) * 100 : 0,
    };
  });
  results.sort((a, b) => b.bags - a.bags);

  return {
    results,
    totals: {
      bags: grandTotalKgs / 60,
      avgDays: grandTotalKgs > 0 ? grandTotalWeight / grandTotalKgs : 0,
    },
  };
}

/** Processing-status buckets by strategy prefix (port of `processWarehouseStatus`). */
export function processWarehouseStatus(rows: StockRow[]): StatusRow[] {
  const stages: Record<StageKey, number> = { PRE: 0, IN: 0, POST: 0, FINISHED: 0, PENDING: 0, UNCLASSIFIED: 0 };
  let totalKgs = 0;

  for (const row of rows) {
    const strategy = row.strategy ? String(row.strategy).toUpperCase().trim() : '';
    const qty = qtyOf(row);
    if (Number.isNaN(qty)) continue;
    totalKgs += qty;
    if (!strategy) stages.UNCLASSIFIED += qty;
    else if (strategy.startsWith('PRE')) stages.PRE += qty;
    else if (strategy.startsWith('IN')) stages.IN += qty;
    else if (strategy.startsWith('POST')) stages.POST += qty;
    else if (strategy.startsWith('FINISHED')) stages.FINISHED += qty;
    else stages.PENDING += qty;
  }

  return (Object.keys(stages) as StageKey[]).map((key) => ({
    stage: STAGE_LABELS[key],
    key,
    bags: stages[key] / 60,
    percentOfTotal: totalKgs > 0 ? (stages[key] / totalKgs) * 100 : 0,
  }));
}

/** PRE/IN rows grouped into (strategy | batch prefix) matrix rows (port of `processMatrixData`). */
export function processMatrixData(rows: StockRow[]): MatrixRow[] {
  const matrixRows: Record<string, MatrixRow> = {};
  for (const row of rows) {
    let strategy = String(row.strategy || '').trim();
    if (!(strategy.startsWith('PRE') || strategy.startsWith('IN'))) continue;
    const itemName = row.itemName ? String(row.itemName).trim() : 'Unknown Item';
    const batchPrefix = String(row.batchId || 'N/A').substring(0, 2).toUpperCase();
    if (strategy.toUpperCase().includes('RECOVERABLE')) strategy = `${strategy} (${itemName})`;
    const qty = qtyOf(row);
    if (Number.isNaN(qty)) continue;
    const key = `${strategy}|${batchPrefix}`;
    (matrixRows[key] ||= { strategy, batchPrefix, totalKgs: 0 }).totalKgs += qty;
  }

  return Object.values(matrixRows).sort((a, b) => {
    const ia = PRE_IN_ORDER.indexOf(a.strategy);
    const ib = PRE_IN_ORDER.indexOf(b.strategy);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.strategy.localeCompare(b.strategy);
  });
}

/**
 * Total theoretical stock per POST grade (port of `calculateTheoreticalStock`):
 * already-in-POST bags + expected bags from applying `percentages` to the
 * PRE/IN matrix, plus FINISHED and Unclassified/Pending pools carried whole.
 */
export function calculateTheoreticalStock(
  rows: StockRow[],
  matrixData: MatrixRow[],
  statusData: StatusRow[],
  percentages: Percentages
): TheoreticalStockResult {
  const stock: Record<string, { alreadyInPost: number; expected: number }> = {};

  const bagsFor = (key: StageKey) => statusData.find((s) => s.key === key)?.bags ?? 0;
  const grandTotalFinished = bagsFor('FINISHED');
  const unclassifiedBags = bagsFor('PENDING') + bagsFor('UNCLASSIFIED');

  for (const row of rows) {
    const strategy = String(row.strategy || '').trim();
    if (!strategy.toUpperCase().startsWith('POST')) continue;
    const qty = qtyOf(row);
    if (Number.isNaN(qty)) continue;
    const target = CONSOLIDATION_MAP[strategy] || strategy;
    (stock[target] ||= { alreadyInPost: 0, expected: 0 }).alreadyInPost += qty / 60;
  }

  for (const row of matrixData) {
    const rowKey = `${row.strategy}|${row.batchPrefix}`;
    const rowPcts = percentages[rowKey];
    if (!rowPcts) continue;
    const inputBags = row.totalKgs / 60;
    for (const postKey in rowPcts) {
      const percent = parseFloat(String(rowPcts[postKey] ?? 0)) || 0;
      if (percent <= 0) continue;
      const target = CONSOLIDATION_MAP[postKey] || postKey;
      (stock[target] ||= { alreadyInPost: 0, expected: 0 }).expected += inputBags * (percent / 100);
    }
  }

  const totals = { alreadyInPost: 0, expected: 0, total: 0 };
  for (const key in stock) {
    if (!key.toUpperCase().startsWith('POST')) continue;
    totals.alreadyInPost += stock[key].alreadyInPost;
    totals.expected += stock[key].expected;
  }

  const order = [...POST_ORDER, ...Object.keys(stock).filter((k) => !POST_ORDER.includes(k)).sort()];
  const grades: TheoreticalStockResult['grades'] = {};
  for (const post of order) {
    const g = stock[post] || { alreadyInPost: 0, expected: 0 };
    grades[post] = { ...g, total: g.alreadyInPost + g.expected };
  }

  totals.total = totals.alreadyInPost + totals.expected + grandTotalFinished + unclassifiedBags;
  return { grades, order, grandTotalFinished, unclassifiedBags, totals };
}

/** Convenience: run the whole counter over parsed stock rows. */
export function runStockCounter(rows: StockRow[], percentages: Percentages, today: Date) {
  const location = processInventoryLocation(rows, today);
  const status = processWarehouseStatus(rows);
  const matrix = processMatrixData(rows);
  const theoretical = calculateTheoreticalStock(rows, matrix, status, percentages);
  return { location, status, matrix, theoretical };
}

/**
 * Theoretical stock keyed for `computeNetPosition`: POST grades plus the
 * FINISHED and Unclassified/Pending rows the Summary sheet carries.
 */
export function theoreticalByGrade(t: TheoreticalStockResult): Record<string, number> {
  const out: Record<string, number> = { FINISHED: t.grandTotalFinished };
  for (const g of t.order) out[g] = t.grades[g].total;
  out['Unclassified/Pending Alignment'] = t.unclassifiedBags;
  return out;
}

// ---------------------------------------------------------------------------
// Assumptions reconciliation (HANDOVER §3 nuance)
//
// `assumptions.json` is keyed `STANDARD_STRATEGY // PHYSICAL_GRADE` with
// outputs in *standard-strategy* space (AA FAQ, GRINDERS, REJECTS, …), while
// the forecast wants `(input strategy | batch prefix) → POST grade → %`.
// Bridging needs three mappings:
//   1. input strategy → standard strategy  (strategy_mapping.json, reversed;
//      batch_mappings.json overrides by batch id),
//   2. the lot's physical grade            (parsed from the XBS item name),
//   3. output standard strategy → POST grade(s).
// Mapping 3 is only partly self-evident (AA↔17 UP, AB↔16, PB↔PB). SPECIALTY,
// ABC, GRINDERS, MBUNIS and REJECTS splits are genuinely ambiguous — those
// outputs are NOT guessed: the row is surfaced in `unresolved` for the trader
// to confirm (then persisted, replacing the default map). CONFIRM WITH IVO.
// ---------------------------------------------------------------------------

export interface AssumptionEntry {
  percentToProcess?: number;
  outputs: Record<string, number>;
}

export interface ReconcileConfig {
  /** `STRATEGY // GRADE` → yield assumption. */
  assumptions: Record<string, AssumptionEntry>;
  /** standard strategy → raw strategy-allocation spellings. */
  strategyMapping: Record<string, string[]>;
  /** full batch id → standard strategy override. */
  batchMappings?: Record<string, string>;
  /** output standard strategy → POST grade weights (null = ambiguous, ask). */
  strategyToPost?: Record<string, Record<string, number> | null>;
}

/**
 * Default output-strategy → POST-grade map. `null` marks splits we refuse to
 * guess (flagged for trader confirmation instead). CONFIRM WITH IVO.
 */
export const DEFAULT_STRATEGY_TO_POST: Record<string, Record<string, number> | null> = {
  'AA TOP': { 'POST 17 UP TOP': 1 },
  'AB TOP': { 'POST 16 TOP': 1 },
  'PB TOP': { 'POST PB - TOP': 1 },
  'AA PLUS': { 'POST 17 UP PLUS': 1 },
  'AB PLUS': { 'POST 16 PLUS': 1 },
  'PB PLUS': { 'POST PB - PLUS': 1 },
  'AA FAQ': { 'POST 17 UP FAQ': 1 },
  'AB FAQ': { 'POST 16 FAQ': 1 },
  'PB FAQ': { 'POST PB - FAQ': 1 },
  SPECIALTY: null,   // POST NATURAL vs POST SPECIALTY WASHED
  'ABC PLUS': null,  // POST 15 PLUS / POST 14 PLUS split
  'ABC FAQ': null,   // POST 15 FAQ / POST 14 FAQ split
  GRINDERS: null,    // BOLD / LIGHT split
  MBUNIS: null,      // POST MH / POST ML split
  REJECTS: null,     // POST REJECTS S / P split
};

/** Physical grades seen in assumption keys, longest-token first for matching. */
const KNOWN_GRADES = [
  'BELOW SCREEN 15', 'Ex office - No.2', 'Ex office - PX', 'GT LIGHTS', 'GT HEAVY',
  'SWEEPINGS', 'UG1', 'UG2', 'UG3', 'AA', 'AB', 'PB', 'SB', 'HE', 'NH', 'NL',
  'MH', 'ML', 'TT', 'UG', 'C', 'E', 'T',
];

/**
 * Extract the physical grade from an XBS item name (longest known token wins).
 * Heuristic until the raw XBS export confirms the item-name format — rows whose
 * grade can't be recognised are flagged, never guessed.
 */
export function extractGrade(itemName: string | undefined): string | null {
  if (!itemName) return null;
  const upper = ` ${String(itemName).toUpperCase().trim()} `;
  for (const grade of KNOWN_GRADES) {
    if (upper.includes(` ${grade.toUpperCase()} `)) return grade;
  }
  return null;
}

/** Strip the PRE/IN stage prefix and any RECOVERABLE item suffix off a matrix strategy. */
function rawStrategyOf(matrixStrategy: string): string {
  return matrixStrategy
    .replace(/\s*\(.*\)\s*$/, '') // RECOVERABLE item-name suffix added by processMatrixData
    .replace(/^(PRE|IN)\s+/i, '')
    .trim();
}

export interface UnresolvedRow {
  rowKey: string;
  reason: 'no-standard-strategy' | 'no-grade' | 'no-assumption' | 'ambiguous-outputs';
  detail: string;
  /** For `ambiguous-outputs`: output strategy → fraction still awaiting a POST split. */
  missingOutputs?: Record<string, number>;
}

export interface ReconcileResult {
  /** Forecast percentages for rows (fully or partially) resolved. */
  percentages: Percentages;
  /** Rows (or row remainders) needing trader confirmation. */
  unresolved: UnresolvedRow[];
}

/**
 * Derive forecast percentages from saved assumptions for the PRE/IN rows —
 * the step Ivo does by hand in the counter UI. Works from raw rows (not the
 * matrix) because the assumption lookup needs each lot's physical grade.
 * Resolves what it can; anything ambiguous lands in `unresolved` instead of
 * being guessed.
 */
export function deriveForecastPercentages(rows: StockRow[], cfg: ReconcileConfig): ReconcileResult {
  const strategyToPost = cfg.strategyToPost ?? DEFAULT_STRATEGY_TO_POST;
  const batchMappings = cfg.batchMappings ?? {};

  // Reverse strategy_mapping: normalized raw spelling → standard strategy.
  const rawToStandard: Record<string, string> = {};
  for (const [standard, raws] of Object.entries(cfg.strategyMapping)) {
    for (const raw of raws) rawToStandard[raw.toUpperCase().trim()] = standard;
  }

  // Group like processMatrixData, tracking per-group grade candidates.
  interface Group { strategy: string; batchPrefix: string; grades: Set<string>; standardOverride?: string }
  const groups: Record<string, Group> = {};
  for (const row of rows) {
    let strategy = String(row.strategy || '').trim();
    if (!(strategy.startsWith('PRE') || strategy.startsWith('IN'))) continue;
    const itemName = row.itemName ? String(row.itemName).trim() : 'Unknown Item';
    const batchId = String(row.batchId || 'N/A');
    const batchPrefix = batchId.substring(0, 2).toUpperCase();
    if (strategy.toUpperCase().includes('RECOVERABLE')) strategy = `${strategy} (${itemName})`;
    const key = `${strategy}|${batchPrefix}`;
    const g = (groups[key] ||= { strategy, batchPrefix, grades: new Set() });
    const grade = extractGrade(row.itemName);
    if (grade) g.grades.add(grade);
    if (batchMappings[batchId]) g.standardOverride = batchMappings[batchId];
  }

  const percentages: Percentages = {};
  const unresolved: UnresolvedRow[] = [];

  for (const [rowKey, g] of Object.entries(groups)) {
    const raw = rawStrategyOf(g.strategy).toUpperCase();
    const standard = g.standardOverride ?? rawToStandard[raw];
    if (!standard) {
      unresolved.push({ rowKey, reason: 'no-standard-strategy', detail: `No standard strategy for "${raw}"` });
      continue;
    }
    if (g.grades.size !== 1) {
      unresolved.push({
        rowKey,
        reason: 'no-grade',
        detail: g.grades.size === 0
          ? 'No physical grade recognised in item names'
          : `Mixed grades in one matrix row: ${[...g.grades].join(', ')}`,
      });
      continue;
    }
    const grade = [...g.grades][0];
    const assumption = cfg.assumptions[`${standard} // ${grade}`];
    if (!assumption) {
      unresolved.push({ rowKey, reason: 'no-assumption', detail: `No assumption for "${standard} // ${grade}"` });
      continue;
    }

    const p2p = assumption.percentToProcess ?? 1;
    const rowPcts: Record<string, number> = {};
    const missing: Record<string, number> = {};
    for (const [outStrategy, fraction] of Object.entries(assumption.outputs)) {
      const postSplit = strategyToPost[outStrategy];
      if (!postSplit) {
        missing[outStrategy] = fraction * p2p;
        continue;
      }
      for (const [post, weight] of Object.entries(postSplit)) {
        rowPcts[post] = (rowPcts[post] || 0) + fraction * p2p * weight * 100;
      }
    }
    if (Object.keys(rowPcts).length > 0) percentages[rowKey] = rowPcts;
    if (Object.keys(missing).length > 0) {
      unresolved.push({
        rowKey,
        reason: 'ambiguous-outputs',
        detail: `Outputs need a POST split: ${Object.keys(missing).join(', ')}`,
        missingOutputs: missing,
      });
    }
  }

  return { percentages, unresolved };
}
