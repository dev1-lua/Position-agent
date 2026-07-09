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
}

export interface PricingResult {
  coverage: { priced: number; unpriced: number; unpricedContracts: string[] };
  overall: PriceBucket & {
    fixed: { contracts: number; smt: number; flatUscLb: number | null };
    ptbf: { contracts: number; smt: number };
  };
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

const newAcc = (): Acc => ({ contracts: 0, smt: 0, difW: 0, difS: 0, fobW: 0, fobS: 0 });

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

const bucketOf = (acc: Acc): PriceBucket => ({
  contracts: acc.contracts,
  smt: round(acc.smt, 4),
  contractDifUscLb: acc.difW ? round(acc.difS / acc.difW, 4) : null,
  fobDifUscLb: acc.fobW ? round(acc.fobS / acc.fobW, 4) : null,
});

export function computePricing(
  sales: Sale[],
  opts: { dimension?: PriceDimension; blends?: Blend[] } = {}
): PricingResult {
  const priced = sales.filter((s) => s.sDif != null || s.sFobDif != null);
  const unpriced = sales.filter((s) => s.sDif == null && s.sFobDif == null);

  const overall = newAcc();
  const fixed = newAcc();
  const ptbf = newAcc();
  let flatW = 0;
  let flatS = 0;

  for (const s of priced) {
    add(overall, s, s.smt);
    if (s.sPrice) {
      add(fixed, s, s.smt);
      const usc = priceToUscLb(s.sPrice, s.sPriceUnit);
      if (usc != null) {
        flatW += s.smt;
        flatS += usc * s.smt;
      }
    } else {
      add(ptbf, s, s.smt);
    }
  }

  let byBucket: Record<string, PriceBucket> | undefined;
  if (opts.dimension) {
    const accs = new Map<string, Acc>();
    const into = (key: string | null | undefined, s: Sale, weight: number) => {
      const k = key?.trim() || 'UNKNOWN';
      const acc = accs.get(k) ?? newAcc();
      accs.set(k, acc);
      add(acc, s, weight);
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
    byBucket = Object.fromEntries([...accs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, a]) => [k, bucketOf(a)]));
  }

  return {
    coverage: {
      priced: priced.length,
      unpriced: unpriced.length,
      unpricedContracts: unpriced.map((s) => s.saleCtr ?? 'unknown'),
    },
    overall: {
      ...bucketOf(overall),
      fixed: {
        contracts: fixed.contracts,
        smt: round(fixed.smt, 4),
        flatUscLb: flatW ? round(flatS / flatW, 4) : null,
      },
      ptbf: { contracts: ptbf.contracts, smt: round(ptbf.smt, 4) },
    },
    byBucket,
  };
}
