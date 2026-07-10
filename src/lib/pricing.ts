import { Blend, Sale } from './types';
import { priceToUscLb, round, saleMtToBags } from './units';

/**
 * Price analytics over the shorts book (unallocated sales).
 *
 * "Price level" on this desk means the differential vs the NY KC contract in
 * USc/lb. Every sale carries two of them: the contract differential (`sDif`,
 * as agreed, on the sale's own Incoterm) and the FOB-equivalent (`sFobDif`,
 * comparable across FOB/CIF/DAP terms). Neither is a headline — both are
 * always reported side by side.
 *
 * Flat price (`sPrice`) is only present on fixed contracts; 0 means
 * price-to-be-fixed (PTBF, differential agreed, futures leg open). Flat
 * prices come in mixed units and are normalized to USc/lb.
 *
 * Averages are SMT-weighted and computed only over sales that carry the
 * field — sales without a differential are never guessed at; they're counted
 * in `coverage.unpriced` and listed so the agent can disclose them.
 */

export type PriceDimension = 'soldGrade' | 'client' | 'deliveryMonth' | 'fixMonth' | 'postGrade';

export interface PriceBucket {
  contracts: number;
  /** Volume weight of the bucket: SMT for contract dimensions; blend-allocated bags for `postGrade`. */
  smt: number;
  /** SMT-weighted average contract differential, USc/lb. */
  contractDifUscLb: number | null;
  /** SMT-weighted average FOB-equivalent differential, USc/lb. */
  fobDifUscLb: number | null;
  /** Contracts with a flat price agreed (futures leg closed). */
  fixed: { contracts: number; smt: number; flatUscLb: number | null };
  /** Price-to-be-fixed contracts — this is the volume that re-rates with NY. */
  ptbf: { contracts: number; smt: number };
}

export interface PricingResult {
  coverage: { priced: number; unpriced: number; unpricedContracts: string[] };
  overall: PriceBucket;
  /** Present when a dimension was requested. Bucket key → stats. */
  byBucket?: Record<string, PriceBucket>;
}

interface Acc {
  contracts: number;
  smt: number;
  difW: number;
  difS: number;
  fobW: number;
  fobS: number;
}

/** One bucket's accumulators: every sale, plus its fixed/PTBF partition. */
interface Group {
  all: Acc;
  fixed: Acc;
  ptbf: Acc;
  flatW: number;
  flatS: number;
}

const newAcc = (): Acc => ({ contracts: 0, smt: 0, difW: 0, difS: 0, fobW: 0, fobS: 0 });
const newGroup = (): Group => ({ all: newAcc(), fixed: newAcc(), ptbf: newAcc(), flatW: 0, flatS: 0 });

function add(acc: Acc, s: Sale, weight: number): void {
  acc.contracts += 1;
  acc.smt += weight;
  if (s.sDif != null) {
    acc.difW += weight;
    acc.difS += s.sDif * weight;
  }
  if (s.sFobDif != null) {
    acc.fobW += weight;
    acc.fobS += s.sFobDif * weight;
  }
}

function addToGroup(g: Group, s: Sale, weight: number): void {
  add(g.all, s, weight);
  if (s.sPrice) {
    add(g.fixed, s, weight);
    const usc = priceToUscLb(s.sPrice, s.sPriceUnit);
    if (usc != null) {
      g.flatW += weight;
      g.flatS += usc * weight;
    }
  } else {
    add(g.ptbf, s, weight);
  }
}

const bucketOf = (g: Group): PriceBucket => ({
  contracts: g.all.contracts,
  smt: round(g.all.smt, 4),
  contractDifUscLb: g.all.difW ? round(g.all.difS / g.all.difW, 4) : null,
  fobDifUscLb: g.all.fobW ? round(g.all.fobS / g.all.fobW, 4) : null,
  fixed: {
    contracts: g.fixed.contracts,
    smt: round(g.fixed.smt, 4),
    flatUscLb: g.flatW ? round(g.flatS / g.flatW, 4) : null,
  },
  ptbf: { contracts: g.ptbf.contracts, smt: round(g.ptbf.smt, 4) },
});

/**
 * Distinct sales contracts whose blend allocates into any of the given POST
 * grades. postGrade buckets attribute one contract to EVERY grade its blend
 * touches, so bucket contract counts overlap and must never be summed — this
 * is the deduplicated rollup. fixed/ptbf follows computePricing's rule
 * (sPrice set → fixed, else price-to-be-fixed).
 */
export function distinctContractsForGrades(
  sales: Sale[],
  blends: Blend[],
  grades: string[]
): { contracts: number; fixed: number; ptbf: number } {
  const wanted = new Set(grades);
  const out = { contracts: 0, fixed: 0, ptbf: 0 };
  for (const s of sales) {
    const blend = blends.find((b) => b.blendNo === s.blendNo);
    if (!blend) continue;
    if (!Object.entries(blend.recipe).some(([g, f]) => !!f && wanted.has(g))) continue;
    out.contracts += 1;
    if (s.sPrice) out.fixed += 1;
    else out.ptbf += 1;
  }
  return out;
}

export function computePricing(
  sales: Sale[],
  opts: { dimension?: PriceDimension; blends?: Blend[] } = {}
): PricingResult {
  const priced = sales.filter((s) => s.sDif != null || s.sFobDif != null);
  const unpriced = sales.filter((s) => s.sDif == null && s.sFobDif == null);

  const overall = newGroup();
  for (const s of priced) addToGroup(overall, s, s.smt);

  let byBucket: Record<string, PriceBucket> | undefined;
  if (opts.dimension) {
    const groups = new Map<string, Group>();
    const into = (key: string | null | undefined, s: Sale, weight: number) => {
      const k = key?.trim() || 'UNKNOWN';
      const g = groups.get(k) ?? newGroup();
      groups.set(k, g);
      addToGroup(g, s, weight);
    };
    for (const s of priced) {
      switch (opts.dimension) {
        case 'soldGrade':
          into(s.sGrade, s, s.smt);
          break;
        case 'client':
          into(s.client, s, s.smt);
          break;
        case 'deliveryMonth':
          into(s.month, s, s.smt);
          break;
        case 'fixMonth':
          into(s.sFixDte, s, s.smt);
          break;
        case 'postGrade': {
          // A sale's price attaches to the whole contract; attribute it to
          // POST grades weighted by the blend-allocated bags of each grade.
          const blend = opts.blends?.find((b) => b.blendNo === s.blendNo);
          if (!blend) {
            into('UNASSIGNED BLEND', s, s.smt);
            break;
          }
          for (const [grade, fraction] of Object.entries(blend.recipe)) {
            if (!fraction) continue;
            into(grade, s, saleMtToBags(s.smt, fraction));
          }
          break;
        }
      }
    }
    byBucket = Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, g]) => [k, bucketOf(g)]));
  }

  return {
    coverage: {
      priced: priced.length,
      unpriced: unpriced.length,
      unpricedContracts: unpriced.map((s) => s.saleCtr ?? 'unknown'),
    },
    overall: bucketOf(overall),
    byBucket,
  };
}
