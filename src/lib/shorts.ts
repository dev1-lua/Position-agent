import { Blend, Sale, ForwardSalesResult, BlendMatch } from './types';
import { matchBlend, AssignmentMemory } from './blends';
import { FORWARD_SALES_SKIP } from './grades';
import { saleMtToBags, round } from './units';

/**
 * Aggregate forward sales (shorts) into a POST-grade × delivery-month matrix.
 *
 * For each sale: resolve its blend, then for every POST grade in the recipe
 * allocate `(SMT × fraction) × 1000/60` bags into `matrix[grade][month]`
 * (BASE FILE cols AW:BS → Forward Sales SUMIF). `POST FAQ MINUS` is skipped
 * to match the workbook. Sales whose blend can't be confidently resolved are
 * returned in `pending` and excluded from the matrix until confirmed.
 */
export function computeForwardSales(
  sales: Sale[],
  blends: Blend[],
  opts: { useAssigned?: boolean; memory?: AssignmentMemory; ambiguousKeys?: Set<string> } = {}
): ForwardSalesResult {
  const matrix: Record<string, Record<string, number>> = {};
  const byGrade: Record<string, number> = {};
  const monthSet = new Set<string>();
  const matches: BlendMatch[] = [];
  const pending: BlendMatch[] = [];

  for (const sale of sales) {
    const m = matchBlend(sale, blends, opts);
    matches.push(m);
    if (m.needsConfirmation || !m.blend) {
      pending.push(m);
      continue;
    }
    const month = sale.month || 'UNKNOWN';
    monthSet.add(month);
    for (const [grade, fraction] of Object.entries(m.blend.recipe)) {
      if (FORWARD_SALES_SKIP.has(grade)) continue;
      if (!fraction) continue;
      const bags = saleMtToBags(sale.smt, fraction);
      (matrix[grade] ||= {})[month] = round((matrix[grade][month] || 0) + bags, 4);
      byGrade[grade] = round((byGrade[grade] || 0) + bags, 4);
    }
  }

  return {
    matrix,
    byGrade,
    months: [...monthSet].sort(),
    pending,
    matches,
  };
}

/**
 * Figure drill-down: the exact sales contracts feeding one POST grade's
 * shorts (optionally one delivery month) — each with its blend fraction and
 * allocated bags, so a quoted matrix cell can be traced to source rows.
 * Same allocation formula as computeForwardSales; the total MUST tie to the
 * corresponding matrix cell / grade total.
 */
export function explainGradeContributions(
  sales: Sale[],
  blends: Blend[],
  grade: string,
  month?: string
): {
  totalBags: number;
  rows: Array<{
    saleCtr: string | null;
    client: string | null;
    month: string | null;
    smt: number;
    blendNo: number | null;
    fraction: number;
    allocatedBags: number;
  }>;
} {
  const byNo = new Map(blends.map((b) => [b.blendNo, b]));
  const rows: ReturnType<typeof explainGradeContributions>['rows'] = [];
  let total = 0;
  for (const s of sales) {
    if (month && s.month !== month) continue;
    const blend = s.blendNo != null ? byNo.get(s.blendNo) : undefined;
    const fraction = blend?.recipe[grade] || 0;
    if (!fraction) continue;
    const bags = round(saleMtToBags(s.smt, fraction), 4);
    if (bags === 0) continue;
    total = round(total + bags, 4);
    rows.push({
      saleCtr: s.saleCtr ?? null,
      client: s.client ?? null,
      month: s.month ?? null,
      smt: s.smt,
      blendNo: s.blendNo ?? null,
      fraction,
      allocatedBags: bags,
    });
  }
  rows.sort((a, b) => a.allocatedBags - b.allocatedBags); // biggest short first
  return { totalBags: total, rows };
}

/** Column-sum a forward-sales matrix → delivery month → total short bags (all grades). */
export function monthTotals(matrix: Record<string, Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const byMonth of Object.values(matrix))
    for (const [mo, v] of Object.entries(byMonth)) out[mo] = round((out[mo] || 0) + v, 4);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Horizon caveat naming the ACTUAL out-of-horizon months carrying volume.
 * R4-F1 (prod 2026-07-13): a hardcoded "(e.g. 2026/10+)" example misled the
 * model into claiming an in-horizon month wasn't netted — name the real
 * months instead, never an example.
 */
export function horizonNote(horizon: string[], byMonth: Record<string, number>): string {
  const outside = Object.keys(byMonth)
    .filter((mo) => byMonth[mo] !== 0 && !horizon.includes(mo))
    .sort();
  return outside.length
    ? `Net position sums shorts over the horizon months only; ${outside.join(', ')} ${outside.length === 1 ? 'appears' : 'appear'} in shortsByMonth but ${outside.length === 1 ? 'is' : 'are'} NOT netted (outside the horizon).`
    : 'Net position sums shorts over the horizon months only; every month carrying shorts is inside the horizon and IS netted.';
}

/** Sum a forward-sales matrix over a specific set of delivery months → grade → bags. */
export function sumOverMonths(
  matrix: Record<string, Record<string, number>>,
  months: string[]
): Record<string, number> {
  const wanted = new Set(months);
  const out: Record<string, number> = {};
  for (const [grade, byMonth] of Object.entries(matrix)) {
    let s = 0;
    for (const [mo, v] of Object.entries(byMonth)) if (wanted.has(mo)) s += v;
    out[grade] = round(s, 4);
  }
  return out;
}
