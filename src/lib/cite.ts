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
}

export function citeLine(c: CiteInput): string {
  const snapshot = `snapshot ${c.positionDate}${c.demo ? ' (DEMO seed, not live data)' : ''}`;
  const parts = [`source: ${c.tool}`, snapshot, c.sources.join(' + ')];
  if (c.updatedAt) {
    // 2026-07-10T01:48:43.154Z → 2026-07-10T01:48Z (minute precision reads better in chat)
    parts.push(`ingested ${c.updatedAt.replace(/:\d{2}(\.\d+)?Z$/, 'Z')}`);
  }
  if (c.derivation) parts.push(`derivation: ${c.derivation}`);
  return parts.join(' · ');
}
