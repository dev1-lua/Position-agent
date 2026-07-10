import { StockRow } from './types';
import { POST_ORDER, CONSOLIDATION_MAP } from './stockcounter';

/**
 * Upload-time coverage report for an XBS stock export — what the parser
 * captured, plus drift warnings when the file's shape departs from the
 * validated 2026-06-18 baseline (session log §11). The golden-day export
 * must produce zero warnings.
 */

/** Strategy tags outside PRE/IN/POST/FINISHED seen on the validated export. */
const KNOWN_PENDING_TAGS = new Set(['DUST', 'STONES', 'MBUNIS', 'SPECIALTY - WASHED']);
/** Counter grades outside POST_ORDER seen on the validated export (Summary!C folds them into POST NATURAL / POST MH). */
const KNOWN_EXTRA_POST_GRADES = new Set(['POST MBUNI HEAVY', 'POST SPECIALTY WASHED']);

/** Per-dimension rollup: row count + bag-equivalents (kg/60). */
export interface CoverageBucket {
  rows: number;
  bags: number;
}

export interface StockCoverage {
  rowCount: number;
  totalBags: number;
  blocked: CoverageBucket;
  /** Rows with no warehouse (work-in-progress lots). */
  wip: CoverageBucket;
  byCropYear: Record<string, CoverageBucket>;
  certTagged: CoverageBucket & { tags: Record<string, CoverageBucket> };
  intakeDates: { parsed: number; missing: number };
  /** Strategy tags outside PRE/IN/POST/FINISHED (counted as Pending, not graded). */
  pendingTags: Record<string, CoverageBucket>;
  /** Blank-strategy rows (counted as Unclassified). */
  unclassified: CoverageBucket;
  /** POST grades outside the counter's POST_ORDER (after consolidation). */
  extraPostGrades: string[];
  zeroQtyRows: number;
  warnings: string[];
}

export function computeStockCoverage(rows: StockRow[]): StockCoverage {
  const bucket = (): CoverageBucket => ({ rows: 0, bags: 0 });
  const bump = (b: CoverageBucket, bags: number) => {
    b.rows++;
    b.bags += bags;
  };

  const cov: StockCoverage = {
    rowCount: rows.length,
    totalBags: 0,
    blocked: bucket(),
    wip: bucket(),
    byCropYear: {},
    certTagged: { ...bucket(), tags: {} },
    intakeDates: { parsed: 0, missing: 0 },
    pendingTags: {},
    unclassified: bucket(),
    extraPostGrades: [],
    zeroQtyRows: 0,
    warnings: [],
  };
  const extraPost = new Set<string>();
  let missingDatesWarehoused = 0;

  for (const r of rows) {
    const qty = typeof r.qty === 'number' ? r.qty : parseFloat(String(r.qty));
    const bags = (Number.isNaN(qty) ? 0 : qty) / 60;
    if (!qty || Number.isNaN(qty)) cov.zeroQtyRows++;
    cov.totalBags += bags;

    if (r.blocked) bump(cov.blocked, bags);
    const hasWarehouse = !!r.warehouse && r.warehouse.trim() !== '';
    if (!hasWarehouse) bump(cov.wip, bags);
    if (r.cropYear) bump((cov.byCropYear[r.cropYear] ||= bucket()), bags);
    if (r.certification) {
      bump(cov.certTagged, bags);
      bump((cov.certTagged.tags[r.certification] ||= bucket()), bags);
    }
    const dateOk = r.intakeDate instanceof Date && !Number.isNaN(r.intakeDate.getTime());
    if (dateOk) cov.intakeDates.parsed++;
    else {
      cov.intakeDates.missing++;
      if (hasWarehouse) missingDatesWarehoused++;
    }

    // Strategy classification mirrors processWarehouseStatus (upper + trim).
    const strategy = String(r.strategy || '').trim();
    const upper = strategy.toUpperCase();
    if (!strategy) bump(cov.unclassified, bags);
    else if (upper.startsWith('POST')) {
      const target = CONSOLIDATION_MAP[strategy] || strategy;
      if (!POST_ORDER.includes(target)) extraPost.add(target);
    } else if (!upper.startsWith('PRE') && !upper.startsWith('IN') && !upper.startsWith('FINISHED')) {
      bump((cov.pendingTags[strategy] ||= bucket()), bags);
    }
  }
  cov.extraPostGrades = [...extraPost].sort();

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const novelPending = Object.entries(cov.pendingTags).filter(([t]) => !KNOWN_PENDING_TAGS.has(t.toUpperCase()));
  if (novelPending.length)
    cov.warnings.push(
      `New unbucketed strategy tag(s) ${novelPending.map(([t, b]) => `"${t}" (${round2(b.bags)} bags)`).join(', ')} — counted as Unclassified/Pending, not graded.`
    );
  const novelPost = cov.extraPostGrades.filter((g) => !KNOWN_EXTRA_POST_GRADES.has(g));
  if (novelPost.length)
    cov.warnings.push(
      `New POST grade(s) ${novelPost.join(', ')} outside the counter's grade list — they count toward totals, but where the Summary sheet folds them is unknown. Confirm with the trader.`
    );
  if (cov.zeroQtyRows > 0)
    cov.warnings.push(`${cov.zeroQtyRows} row(s) have a missing/unparseable Qty — they contribute 0 bags.`);
  if (missingDatesWarehoused > 0)
    cov.warnings.push(
      `${missingDatesWarehoused} warehoused row(s) have no parseable Intake Date — stock-age averages will exclude them.`
    );

  return cov;
}
