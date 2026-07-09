import { DnpRow, Sale } from './types';
import { MT_PER_LOT, MT_PER_BAG } from './units';

/**
 * Futs + Spread — the MT/hedge view of the position, replicating the
 * workbook's `Futs + Spread` sheet (formulas captured verbatim there).
 *
 * Inputs marked MANUAL come from SOL futures pots / cert workbooks the desk
 * enters by hand each day (HANDOVER §2) until those sources are wired.
 *
 * Excel SUMIFS text criteria are case-INSENSITIVE (the sheet writes
 * `<>Kenyacof` while the export says `KENYACOF`) — comparisons here match
 * that, validated exactly against the golden day.
 */

const ciEq = (a: string, b: string): boolean => a.trim().toUpperCase() === b.trim().toUpperCase();

export interface FutsManualInputs {
  /** B4 — Contracted, not in stock, no hedge assigned (MT). */
  contractedNotInStockNoHedgeMt?: number;
  /** B5 — Contracted, not in stock, hedges assigned (MT). */
  contractedNotInStockHedgedMt?: number;
  /** B6 — Not contracted, not in stock, no hedges assigned (MT). */
  notContractedNotInStockMt?: number;
  /** B14 — Kenyacof pot total futures MT (SOL "Kenyacof26" bottom row). */
  kenyacofFutsMt?: number;
  /** B15 — KenyaZZ pot MT (blank on the golden day → line stays null). */
  kenyaZzMt?: number | null;
  /** F24 — adjustment subtracted from Expected Specialty Sales (MT). */
  expectedSpecialtyAdjustMt?: number;
  /** B26 — Δ Hedge from the KENY_AR_DYN pot (MT). */
  deltaHedgeKenyArDynMt?: number;
  /** Certificate positions (AAA Cert / NET POSITION / CP-Purchases workbooks) — carried through until those sources are wired. */
  certificates?: Record<string, number>;
}

export interface FutsSpreadInputs {
  /** Summary!C26 — total theoretical stock in bags (incl. recent purchases). */
  theoreticalTotalBags: number;
  /** Summary!C4 — POST NATURAL theoretical bags. */
  postNaturalBags: number;
  /** Summary!C23 / C24 — Rejects S / P theoretical bags. */
  rejectsSBags: number;
  rejectsPBags: number;
  /** SUM(Summary!E4:P4) — POST NATURAL forward-sales bags over the report months. */
  postNaturalForwardBags: number;
  /** Parsed DailyNetPosition rows. */
  dnp: DnpRow[];
  manual?: FutsManualInputs;
}

export interface FutsLine {
  mt: number | null;
  lots: number | null;
}

export interface FutsSpreadResult {
  /** Line label (matching the sheet) → MT + lots. */
  lines: Record<string, FutsLine>;
  /** Sheet display order for `lines`. */
  order: string[];
  /** Manual certificate positions, passed through for the report. */
  certificates: Record<string, number>;
}

/** B8 — stock Sucafina bought directly, unsold, hedgeable (SUMIFS over DailyNetPosition P.MT). */
export function directSalesStockMt(dnp: DnpRow[]): number {
  let sum = 0;
  for (const r of dnp) {
    if (!ciEq(r.quality, 'Hedgeable')) continue;
    if (ciEq(r.company, 'RABOBANK IN') || ciEq(r.company, 'Kenyacof')) continue;
    if (ciEq(r.state, '0-In Store Origin unsold') || ciEq(r.state, '2-To Be Shipped Unsold')) sum += r.pMt;
  }
  return -sum;
}

/** B18 — futures in Sucafina books (SUMIFS over DailyNetPosition TotLine). */
export function sucafinaFuturesMt(dnp: DnpRow[]): number {
  let sum = 0;
  for (const r of dnp) {
    if (!ciEq(r.quality, 'Hedgeable')) continue;
    if (ciEq(r.state, 'invoiced with fixing only')) continue;
    if (ciEq(r.company, 'RABOBANK IN')) continue;
    sum += r.totLine;
  }
  return sum;
}

export function computeFutsSpread(input: FutsSpreadInputs): FutsSpreadResult {
  const m = input.manual ?? {};
  const lots = (mt: number): number => mt / MT_PER_LOT;
  const line = (mt: number): FutsLine => ({ mt, lots: lots(mt) });

  const stockMt = input.theoreticalTotalBags * MT_PER_BAG; // B2 = Summary!C26 × 0.06
  const b4 = m.contractedNotInStockNoHedgeMt ?? 0;
  const b5 = m.contractedNotInStockHedgedMt ?? 0;
  const b6 = m.notContractedNotInStockMt ?? 0;
  const stockAllDsMt = stockMt + b4 + b5 + b6; // B3

  const dssMt = directSalesStockMt(input.dnp); // B8
  const lgNonHedgeableMt = -((input.rejectsSBags + input.rejectsPBags) * 60 / 1000) * 0.2; // B9
  const specialtyNegMt = -(input.postNaturalBags * 60 / 1000); // B10
  const stockHedgeableMt = stockAllDsMt + dssMt + lgNonHedgeableMt + specialtyNegMt; // B12

  const kenyacofFutsMt = m.kenyacofFutsMt ?? 0; // B14 MANUAL
  const kenyaZzMt = m.kenyaZzMt ?? null; // B15 MANUAL (blank → null line, 0 in sums)
  const kenyacofNetMt = stockHedgeableMt + kenyacofFutsMt + (kenyaZzMt ?? 0); // B16

  const sucafinaMt = sucafinaFuturesMt(input.dnp); // B18
  const trueNetLots = lots(kenyacofNetMt) + lots(sucafinaMt); // C21 (lots-only line)

  const specialtyPosMt = -specialtyNegMt; // B23
  const expectedSpecialtySalesMt =
    input.postNaturalForwardBags * MT_PER_BAG - (m.expectedSpecialtyAdjustMt ?? 0); // B24
  const netSpecialtyMt = specialtyPosMt + expectedSpecialtySalesMt; // B25
  const deltaHedgeMt = m.deltaHedgeKenyArDynMt ?? 0; // B26 MANUAL

  const lines: Record<string, FutsLine> = {
    Stock: line(stockMt),
    'Stock when all DS arrives': line(stockAllDsMt),
    'Contracted, not in stock, no hedge assigned': line(b4),
    'Contracted, not in stock, hedges assigned': line(b5),
    'Not contracted, not in stock, no hedges assigned': line(b6),
    'Direct Sales Stock': line(dssMt),
    'LG Non hedgeable': line(lgNonHedgeableMt),
    'Specialty Coffee': line(specialtyPosMt),
    'Stock hedgeable': line(stockHedgeableMt),
    'Kenyacof futs': line(kenyacofFutsMt),
    KenyaZZ: kenyaZzMt == null ? { mt: null, lots: null } : line(kenyaZzMt),
    'Kenyacof Net': line(kenyacofNetMt),
    Sucafina: line(sucafinaMt),
    True_Net_Excl_Specialty: { mt: null, lots: trueNetLots },
    'Expected Specialty Sales': line(expectedSpecialtySalesMt),
    'Net Specialty': line(netSpecialtyMt),
    'Δ Hedge (KENY_AR_DYN)': line(deltaHedgeMt),
  };

  return { lines, order: Object.keys(lines), certificates: m.certificates ?? {} };
}

/**
 * The sheet's futures pivot (`Sum of SMT` by `sFixDte`, rows 32:38) computed
 * live from the sales instead of Excel's cached pivot — the golden workbook's
 * copy was stale (its own "REMEMBER TO REFRESH THIS TABLE" note).
 */
export function futuresPotBySFixDte(sales: Sale[]): { byPot: Record<string, number>; totalMt: number } {
  const byPot: Record<string, number> = {};
  let totalMt = 0;
  for (const s of sales) {
    const pot = (s.sFixDte || '').trim();
    if (!pot) continue;
    byPot[pot] = (byPot[pot] || 0) + s.smt;
    totalMt += s.smt;
  }
  return { byPot, totalMt };
}
