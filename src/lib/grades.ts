/**
 * POST export-grade taxonomy, mirroring the LongShort workbook.
 *
 * Blend recipes (Blends sheet, BASE FILE cols Z:AV) carry 23 POST grades,
 * including `POST FAQ MINUS`. The Summary / Forward Sales sheets track 22 —
 * `POST FAQ MINUS` is intentionally dropped from the forward-sales aggregation
 * (Forward Sales row mapping skips BASE FILE col BM). We replicate that exactly.
 */

/** The 23 POST grades a blend recipe can allocate to (Blends sheet order, cols E..AA). */
export const POST_GRADES_RECIPE = [
  'FINISHED',
  'POST NATURAL',
  'POST 17 UP TOP',
  'POST 16 TOP',
  'POST 15 TOP',
  'POST PB - TOP',
  'POST 17 UP PLUS',
  'POST 16 PLUS',
  'POST 15 PLUS',
  'POST 14 PLUS',
  'POST PB - PLUS',
  'POST 17 UP FAQ',
  'POST 16 FAQ',
  'POST 15 FAQ',
  'POST 14 FAQ',
  'POST PB - FAQ',
  'POST FAQ MINUS',
  'POST GRINDER BOLD',
  'POST GRINDER LIGHT',
  'POST MH',
  'POST ML',
  'POST REJECTS S',
  'POST REJECTS P',
] as const;

/** Grades dropped from the forward-sales / net-position aggregation (workbook parity). */
export const FORWARD_SALES_SKIP = new Set<string>(['POST FAQ MINUS']);

/** The 22 POST grades tracked on Summary / Forward Sales (recipe order minus the skipped ones). */
export const POST_GRADES_SUMMARY: string[] = POST_GRADES_RECIPE.filter((g) => !FORWARD_SALES_SKIP.has(g));

/**
 * Offer groupings (Summary Offers block): net position rolled up into the
 * commercial buckets a trader quotes on. Values are net-position bags summed
 * over the member grades, later converted to MT (× 0.06).
 */
export const OFFER_GROUPS: Record<string, string[]> = {
  TOP: ['POST 17 UP TOP', 'POST 16 TOP', 'POST 15 TOP', 'POST PB - TOP'],
  PLUS: ['POST 17 UP PLUS', 'POST 16 PLUS', 'POST 15 PLUS', 'POST 14 PLUS', 'POST PB - PLUS'],
  'AA FAQ': ['POST 17 UP FAQ'],
  'AB FAQ': ['POST 16 FAQ'], // note: workbook applies partial weights (0.5·POST15FAQ) — see netposition.ts
  'ABC FAQ': ['POST 15 FAQ', 'POST 14 FAQ', 'POST PB - FAQ'],
  'GRINDER 14+': ['POST GRINDER BOLD'],
  'GRINDER 13-': ['POST GRINDER LIGHT', 'POST MH'],
};

/** A blank per-grade bag map keyed by the 22 summary grades. */
export function emptyGradeMap(): Record<string, number> {
  const m: Record<string, number> = {};
  for (const g of POST_GRADES_SUMMARY) m[g] = 0;
  return m;
}

/** Normalise a grade label for tolerant comparison (case/space/hyphen-insensitive). */
export function normGrade(s: string): string {
  return String(s || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .trim();
}
