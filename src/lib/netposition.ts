import { NetPositionResult } from './types';
import { POST_GRADES_SUMMARY } from './grades';
import { bagsToMt, round } from './units';

/**
 * Net position = theoretical stock (longs, +) + forward sales (shorts, −),
 * per POST grade. `forwardByGrade` should already be summed over the desired
 * delivery-month horizon (see `sumOverMonths`).
 *
 * `theoretical` may include extra rows (e.g. `Unclassified/Pending Alignment`)
 * that aren't in the 22 summary grades — those are carried through so totals tie.
 */
export function computeNetPosition(
  theoretical: Record<string, number>,
  forwardByGrade: Record<string, number>
): NetPositionResult {
  const grades = new Set<string>([...POST_GRADES_SUMMARY, ...Object.keys(theoretical)]);
  const byGrade: NetPositionResult['byGrade'] = {};
  const total = { theoretical: 0, forwardSales: 0, net: 0 };

  for (const g of grades) {
    const theo = round(theoretical[g] || 0, 4);
    const fwd = round(forwardByGrade[g] || 0, 4);
    const net = round(theo + fwd, 4);
    byGrade[g] = { theoretical: theo, forwardSales: fwd, net };
    total.theoretical = round(total.theoretical + theo, 4);
    total.forwardSales = round(total.forwardSales + fwd, 4);
    total.net = round(total.net + net, 4);
  }
  return { byGrade, total };
}

/**
 * Offer roll-ups (Summary Offers block), with the workbook's exact weights.
 * Values are net-position bags; `mt` = bags × 0.06.
 */
const OFFER_SPEC: Record<string, Array<[string, number]>> = {
  TOP: [['POST 17 UP TOP', 1], ['POST 16 TOP', 1], ['POST 15 TOP', 1], ['POST PB - TOP', 1]],
  PLUS: [['POST 17 UP PLUS', 1], ['POST 16 PLUS', 1], ['POST 15 PLUS', 1], ['POST 14 PLUS', 1], ['POST PB - PLUS', 1]],
  'AA FAQ': [['POST 17 UP FAQ', 1]],
  'AB FAQ': [['POST 16 FAQ', 1], ['POST 15 FAQ', 0.5]],
  'ABC FAQ': [['POST 15 FAQ', 0.5], ['POST 14 FAQ', 1]],
  'GRINDER 14+': [['POST GRINDER BOLD', 1]],
  'GRINDER 13-': [['POST GRINDER LIGHT', 1], ['POST MH', 1]],
};

/**
 * Resolve a trader's offer-name query ("AB FAQ", "grinder 14+") to its offer
 * group and weighted member grades. Returns null for anything that isn't an
 * offer name — real POST grade names must keep resolving as grades.
 */
export function resolveOfferQuery(q: string): { offer: string; members: Array<[string, number]> } | null {
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
  const target = norm(q);
  for (const [offer, members] of Object.entries(OFFER_SPEC)) {
    if (norm(offer) === target) return { offer, members: members.map(([g, w]) => [g, w]) };
  }
  return null;
}

export function computeOffers(
  net: NetPositionResult
): Record<string, { bags: number; mt: number }> {
  const out: Record<string, { bags: number; mt: number }> = {};
  for (const [group, members] of Object.entries(OFFER_SPEC)) {
    let bags = 0;
    for (const [grade, weight] of members) bags += (net.byGrade[grade]?.net || 0) * weight;
    bags = round(bags, 2);
    out[group] = { bags, mt: round(bagsToMt(bags), 2) };
  }
  return out;
}
