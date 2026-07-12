/**
 * Code-computed position insights.
 *
 * The persona bans the model from deriving its own numbers (hard rule 1), so
 * every observation worth surfacing — largest short month, concentration,
 * net-short grades, out-of-horizon shorts, hedge residual — is computed HERE
 * and returned as finished strings the model quotes verbatim. This module is
 * the single wording source: the parity test asserts these strings exactly,
 * so production output and the spec can never drift apart.
 *
 * Every insight is guarded — omit rather than emit: no division by zero, no
 * "0% of 0", no NaN. An empty array is a valid result.
 */

export interface PositionInsightInputs {
  /** Position date YYYY-MM-DD (anchors the "next 3 delivery months" window). */
  positionDate: string;
  /** Netting horizon months YYYY/MM (defaultHorizon / net.horizon). */
  horizon: string[];
  /** monthTotals() output: delivery month → short bags (negative). May carry an UNKNOWN key. */
  shortsByMonth: Record<string, number>;
  /** net.byGrade — theoretical/forwardSales/net per grade (bags). */
  byGrade: Record<string, { theoretical: number; forwardSales: number; net: number }>;
  /** Rounded hedge lines from the futs view, when the DNP export is on file. */
  hedgeLines?: Record<string, { mt: number | null; lots: number | null }>;
}

const MONTH_RE = /^\d{4}\/\d{2}$/;

/** Whole bags, unsigned, thousands-separated (matches the morning report's fmt). */
const bags = (n: number): string => Math.round(Math.abs(n)).toLocaleString('en-US');

/** Signed figure with a typographic minus, keeping any decimals the caller rounded to. */
const signed = (n: number): string => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}`;

/** YYYY/MM advanced by `add` months. */
const addMonths = (ym: string, add: number): string => {
  const [y, m] = ym.split('/').map(Number);
  const t = y * 12 + (m - 1) + add;
  return `${Math.floor(t / 12)}/${String((t % 12) + 1).padStart(2, '0')}`;
};

export function computePositionInsights(i: PositionInsightInputs): string[] {
  const out: string[] = [];
  const horizonSet = new Set(i.horizon);

  // Horizon months that actually carry shorts (UNKNOWN and malformed keys excluded).
  const horizonMonths = Object.entries(i.shortsByMonth)
    .filter(([m, v]) => MONTH_RE.test(m) && horizonSet.has(m) && v !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const horizonTotal = horizonMonths.reduce((s, [, v]) => s + Math.abs(v), 0);

  // 1. Largest short month (ties broken by earliest month — deterministic).
  if (horizonTotal > 0) {
    const [topMonth, topV] = horizonMonths.reduce((best, cur) => (Math.abs(cur[1]) > Math.abs(best[1]) ? cur : best));
    const pct = Math.round((Math.abs(topV) / horizonTotal) * 100);
    out.push(`Largest short month: ${topMonth} — ${bags(topV)} bags, ${pct}% of horizon shorts.`);
  }

  // 2. Concentration in the next 3 delivery months (position-date month + 2).
  if (horizonTotal > 0) {
    const m0 = i.positionDate.slice(0, 7).replace('-', '/');
    const window = [m0, addMonths(m0, 1), addMonths(m0, 2)].filter((m) => horizonSet.has(m));
    const windowSum = window.reduce((s, m) => s + Math.abs(i.shortsByMonth[m] ?? 0), 0);
    const pct = Math.round((windowSum / horizonTotal) * 100);
    // Vacuous when every active month already sits in the window.
    const vacuous = pct === 100 && horizonMonths.length <= 3;
    if (window.length && windowSum > 0 && !vacuous)
      out.push(`${pct}% of horizon shorts fall in the next 3 delivery months (${window[0]}–${window[window.length - 1]}).`);
  }

  // 3. Net-short grades, most short first, capped at 5.
  const netShort = Object.entries(i.byGrade)
    .filter(([, v]) => v.net < 0)
    .sort(([, a], [, b]) => a.net - b.net);
  if (netShort.length) {
    const listed = netShort.slice(0, 5).map(([g, v]) => `${g} (−${bags(v.net)})`);
    const more = netShort.length > 5 ? ` + ${netShort.length - 5} more` : '';
    out.push(
      netShort.length === 1
        ? `1 grade is net short: ${listed[0]}.`
        : `${netShort.length} grades are net short: ${listed.join(', ')}${more}.`
    );
  }

  // 4. Shorts outside the netting horizon (they show in shortsByMonth but are NOT netted).
  const outside = Object.entries(i.shortsByMonth)
    .filter(([m, v]) => !horizonSet.has(m) && v !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (outside.length) {
    const total = outside.reduce((s, [, v]) => s + Math.abs(v), 0);
    const labels = outside.map(([m]) => (MONTH_RE.test(m) ? m : 'month unknown'));
    out.push(`${bags(total)} bags of shorts sit outside the netting horizon (${labels.join(', ')}) — not in the net figures.`);
  }

  // 5. Hedge residual — quotes lines computeFutsSpread already produced, no new arithmetic.
  const lots = i.hedgeLines?.['True_Net_Excl_Specialty']?.lots;
  if (lots != null) {
    const kenyacof = i.hedgeLines?.['Kenyacof Net']?.mt;
    const sucafina = i.hedgeLines?.['Sucafina']?.mt;
    const detail = [
      kenyacof != null ? `Kenyacof Net ${signed(kenyacof)} MT` : null,
      sucafina != null ? `Sucafina ${signed(sucafina)} MT` : null,
    ].filter(Boolean);
    out.push(`Hedge view: true net excl. specialty ${signed(lots)} lots${detail.length ? ` (${detail.join(', ')})` : ''}.`);
  }

  return out;
}
