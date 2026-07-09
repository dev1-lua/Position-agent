import { Blend, Sale, ForwardSalesResult, BlendMatch } from './types';
import { matchBlend } from './blends';
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
  opts: { useAssigned?: boolean } = {}
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
