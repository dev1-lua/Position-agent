/**
 * Machine-built citation line attached to every query-tool result.
 *
 * The desk mandate (2026-07-10): every number the agent quotes must carry
 * proper provenance — which tool computed it, which snapshot day, whether
 * that snapshot is the demo seed, which source export(s) it derives from,
 * and when the data was ingested. Building the line HERE (not in the model)
 * makes citation mechanical: the agent copies it verbatim, it never has to
 * compose — or guess — provenance.
 */

export interface CiteInput {
  /** Tool that produced the numbers, e.g. `price-analytics`. */
  tool: string;
  /** Snapshot position date, `YYYY-MM-DD`. */
  positionDate: string;
  /** True when the snapshot is the bundled demo/validation seed. */
  demo?: boolean;
  /** Snapshot `updatedAt` ISO timestamp (when the data was ingested/computed). */
  updatedAt?: string;
  /** Source export(s) the figures derive from, e.g. `['SOL ReportLogistic']`. */
  sources: string[];
  /**
   * The exact data points behind the headline figure: source column(s),
   * formula, and workbook location, e.g.
   * `blocked = Σ XBS "Qty."(kg)/60 over rows where Blocked=Yes (68 rows)`.
   */
  derivation?: string;
  /** Override "today" (`YYYY-MM-DD`) for deterministic tests; defaults to the current UTC date. */
  today?: string;
}

/** Whole days between the snapshot's position date and today (UTC). ≤0 = current. */
export function snapshotAgeDays(positionDate: string, today?: string): number {
  const t = today ?? new Date().toISOString().slice(0, 10);
  return Math.round((Date.parse(t) - Date.parse(positionDate)) / 86_400_000);
}

/**
 * Ready-made stale-upload banner, or undefined when the snapshot is current.
 *
 * QA 2026-07-12 (finding F2): when the model composed this banner itself from
 * persona rule 6, it reworded it or dropped it entirely on some turns. Built
 * HERE for the same reason citeLine is — the tool result carries the finished
 * sentence and the persona prepends it verbatim, so it can never drift.
 * The wording mirrors persona hard rule 6; change both together or neither.
 */
export function staleNotice(positionDate: string, today?: string): string | undefined {
  const age = snapshotAgeDays(positionDate, today);
  if (age < 1) return undefined;
  return `⚠️ Based on the ${positionDate} upload (${age} day${age === 1 ? '' : 's'} old). No newer data has been uploaded — upload today's three exports for current figures.`;
}

export function citeLine(c: CiteInput): string {
  // Staleness is computed HERE, mechanically, for the same reason the rest of
  // the line is: the desk uploads fresh exports each morning, and if none came
  // in, the trader must be told he is reading old data — without trusting the
  // model to compare dates. The persona relays the "N days old" tag up front.
  const tags: string[] = [];
  if (c.demo) tags.push('DEMO seed, not live data');
  const age = snapshotAgeDays(c.positionDate, c.today);
  if (age >= 1) tags.push(`${age} day${age === 1 ? '' : 's'} old — latest upload on file`);
  const snapshot = `snapshot ${c.positionDate}${tags.length ? ` (${tags.join('; ')})` : ''}`;
  const parts = [`source: ${c.tool}`, snapshot, c.sources.join(' + ')];
  if (c.updatedAt) {
    // 2026-07-10T01:48:43.154Z → 2026-07-10T01:48Z (minute precision reads better in chat)
    parts.push(`ingested ${c.updatedAt.replace(/:\d{2}(\.\d+)?Z$/, 'Z')}`);
  }
  if (c.derivation) parts.push(`derivation: ${c.derivation}`);
  return parts.join(' · ');
}
