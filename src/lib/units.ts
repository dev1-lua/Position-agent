/**
 * Unit constants and conversions used across the position maths.
 *
 * Coffee is counted in 60 kg bags. Sales in SOL are recorded in metric tons
 * (MT). ICE Arabica futures trade in lots of 37,500 lb ≈ 17.01 MT.
 *
 * Derived from the LongShort workbook:
 *  - bags → MT:  bags * 0.06            (60 kg = 0.06 MT)
 *  - MT   → lots: MT / 17.01
 *  - a sale's bags per POST grade: (SMT * blendFraction) * 1000 / 60
 *    (SMT in MT → *1000 = kg → /60 = bags), matching BASE FILE col AW: `=($K2*Z2)*1000/60`.
 */
export const KG_PER_BAG = 60;
export const MT_PER_BAG = 0.06;
export const MT_PER_LOT = 17.01;

export const bagsToMt = (bags: number): number => bags * MT_PER_BAG;
export const mtToBags = (mt: number): number => (mt * 1000) / KG_PER_BAG;
export const mtToLots = (mt: number): number => mt / MT_PER_LOT;

/** Bags of a POST grade consumed by a sale of `smt` metric tons at `fraction` of its blend. */
export const saleMtToBags = (smt: number, fraction: number): number => (smt * fraction * 1000) / KG_PER_BAG;

/** Round to `dp` decimal places, avoiding -0. */
export const round = (n: number, dp = 2): number => {
  const f = Math.pow(10, dp);
  const r = Math.round((n + Number.EPSILON) * f) / f;
  return r === 0 ? 0 : r;
};
