import { DnpRow, Sale } from './types';
import { round } from './units';

/**
 * Certification / EUDR exposure — honestly partial by nature.
 *
 * Sales side: `S.Cert` on the shorts book (tags ~19/61 contracts on the
 * reference export). Stock side: the DNP `certification` column over unsold
 * purchase rows (the same state filter the workbook's Direct Sales Stock
 * uses), tagged ~114/459 rows. An untagged row means UNKNOWN certification —
 * never "not certified" — so untagged volume is always reported alongside.
 *
 * EUDR-flagged = any tag containing "EUDR" (RA.EUDR, CP.EUDR, AAA.EUDR, …).
 */

const UNSOLD_STATES = new Set(['0-In Store Origin unsold', '2-To Be Shipped Unsold']);
export const UNTAGGED = 'UNTAGGED';

const isEudr = (tag: string) => tag.toUpperCase().includes('EUDR');

export interface CertExposureResult {
  sales: {
    total: { contracts: number; smt: number };
    tagged: { contracts: number; smt: number };
    /** Cert tag (or UNTAGGED) → contracts and SMT. */
    byTag: Record<string, { contracts: number; smt: number }>;
    eudr: { contracts: number; smt: number; sharePct: number };
  };
  /**
   * Unsold physical stock by cert tag (purchase MT). Null when the snapshot's
   * DNP rows predate certification capture — re-ingest to populate.
   */
  stock: {
    rows: number;
    totalMt: number;
    byTag: Record<string, { rows: number; mt: number }>;
    eudr: { rows: number; mt: number; sharePct: number };
  } | null;
}

const sortTags = <T>(entries: Map<string, T>): Record<string, T> =>
  Object.fromEntries([...entries.entries()].sort(([a], [b]) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b))));

export function computeCertExposure(sales: Sale[], dnp?: DnpRow[]): CertExposureResult {
  const byTag = new Map<string, { contracts: number; smt: number }>();
  const total = { contracts: 0, smt: 0 };
  const tagged = { contracts: 0, smt: 0 };
  const eudr = { contracts: 0, smt: 0 };
  for (const s of sales) {
    const tag = s.sCert?.trim() || UNTAGGED;
    const b = byTag.get(tag) ?? { contracts: 0, smt: 0 };
    byTag.set(tag, b);
    b.contracts += 1;
    b.smt += s.smt;
    total.contracts += 1;
    total.smt += s.smt;
    if (tag !== UNTAGGED) {
      tagged.contracts += 1;
      tagged.smt += s.smt;
      if (isEudr(tag)) {
        eudr.contracts += 1;
        eudr.smt += s.smt;
      }
    }
  }
  for (const b of byTag.values()) b.smt = round(b.smt, 4);

  let stock: CertExposureResult['stock'] = null;
  // Rows parsed before `certification` was captured lack the field entirely;
  // reporting them as untagged would fabricate a 0%-certified stock answer.
  if (dnp && dnp.length > 0 && dnp.some((r) => r.certification !== undefined)) {
    const stockByTag = new Map<string, { rows: number; mt: number }>();
    const stockTotal = { rows: 0, mt: 0 };
    const stockEudr = { rows: 0, mt: 0 };
    for (const r of dnp) {
      if (!UNSOLD_STATES.has(r.state) || !r.pMt) continue;
      const tag = r.certification?.trim() || UNTAGGED;
      const b = stockByTag.get(tag) ?? { rows: 0, mt: 0 };
      stockByTag.set(tag, b);
      b.rows += 1;
      b.mt += r.pMt;
      stockTotal.rows += 1;
      stockTotal.mt += r.pMt;
      if (tag !== UNTAGGED && isEudr(tag)) {
        stockEudr.rows += 1;
        stockEudr.mt += r.pMt;
      }
    }
    for (const b of stockByTag.values()) b.mt = round(b.mt, 4);
    stock = {
      rows: stockTotal.rows,
      totalMt: round(stockTotal.mt, 4),
      byTag: sortTags(stockByTag),
      eudr: {
        rows: stockEudr.rows,
        mt: round(stockEudr.mt, 4),
        sharePct: stockTotal.mt ? round((stockEudr.mt / stockTotal.mt) * 100, 1) : 0,
      },
    };
  }

  return {
    sales: {
      total: { contracts: total.contracts, smt: round(total.smt, 4) },
      tagged: { contracts: tagged.contracts, smt: round(tagged.smt, 4) },
      byTag: sortTags(byTag),
      eudr: {
        contracts: eudr.contracts,
        smt: round(eudr.smt, 4),
        sharePct: total.smt ? round((Math.abs(eudr.smt) / Math.abs(total.smt)) * 100, 1) : 0,
      },
    },
    stock,
  };
}
