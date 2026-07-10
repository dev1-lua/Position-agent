import { LocationSummary } from './stockcounter';
import { StockCoverage } from './stockcoverage';

/**
 * Flat stock analytics over the rollups ingest-stock-report persists in the
 * snapshot (location summary + upload-time coverage). Four dimensions:
 * warehouse | cropYear | blocked | cert. Honesty rules (session log §11):
 * blocked / WIP / old-crop stock COUNTS toward the total — report carve-outs,
 * never subtract silently; untagged = certification UNKNOWN; every sharePct
 * is share of the TOTAL bags.
 */

export type StockDimension = 'warehouse' | 'cropYear' | 'blocked' | 'cert';

export interface DimBucket {
  rows: number;
  bags: number;
  /** Share of the TOTAL bags (tagged + untagged, blocked + free…), percent. */
  sharePct: number;
}

export interface WarehouseRow {
  /** Display name (In Our Warehouse / No Warehouse Assigned / Pending Arrival (X)). */
  location: string;
  originalName: string;
  bags: number;
  /** Intake-age weighted average days; dateless kgs dilute the average. */
  avgDays: number;
  sharePct: number;
}

export interface StockAnalyticsResult {
  dimension: StockDimension;
  totals: { bags: number; rows?: number };
  warehouses?: WarehouseRow[];
  byCropYear?: Record<string, DimBucket>;
  blocked?: DimBucket;
  notBlocked?: { rows: number; bags: number };
  tagged?: DimBucket;
  untagged?: { rows: number; bags: number };
  byTag?: Record<string, DimBucket>;
}

export interface StockAnalyticsInput {
  location: LocationSummary;
  coverage?: StockCoverage | null;
}

/**
 * Returns null when the dimension needs the coverage rollup and the snapshot
 * has none (ingested before coverage capture) — the tool declines honestly.
 */
export function computeStockAnalytics(
  dimension: StockDimension,
  stock: StockAnalyticsInput
): StockAnalyticsResult | null {
  if (dimension === 'warehouse') {
    // Straight off the persisted location summary; percentOfTotal is already
    // share-of-total. The "No Warehouse Assigned" row IS the WIP carve-out.
    return {
      dimension,
      totals: { bags: stock.location.totals.bags },
      warehouses: stock.location.results.map((r) => ({
        location: r.location,
        originalName: r.originalName,
        bags: r.bags,
        avgDays: r.avgDays,
        sharePct: r.percentOfTotal,
      })),
    };
  }

  const cov = stock.coverage;
  if (!cov) return null; // snapshot predates coverage capture — decline honestly

  const share = (bags: number) => (cov.totalBags > 0 ? (bags / cov.totalBags) * 100 : 0);
  const dim = (b: { rows: number; bags: number }): DimBucket => ({ rows: b.rows, bags: b.bags, sharePct: share(b.bags) });
  const totals = { bags: cov.totalBags, rows: cov.rowCount };

  if (dimension === 'cropYear') {
    return {
      dimension,
      totals,
      byCropYear: Object.fromEntries(Object.entries(cov.byCropYear).map(([year, b]) => [year, dim(b)])),
    };
  }
  if (dimension === 'blocked') {
    return {
      dimension,
      totals,
      blocked: dim(cov.blocked),
      notBlocked: { rows: cov.rowCount - cov.blocked.rows, bags: cov.totalBags - cov.blocked.bags },
    };
  }
  // cert
  return {
    dimension,
    totals,
    tagged: dim(cov.certTagged),
    untagged: { rows: cov.rowCount - cov.certTagged.rows, bags: cov.totalBags - cov.certTagged.bags },
    byTag: Object.fromEntries(Object.entries(cov.certTagged.tags).map(([tag, b]) => [tag, dim(b)])),
  };
}
