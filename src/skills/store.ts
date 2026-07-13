import { Data, User } from 'lua-cli';
import { AssignmentMemory } from '../lib/blends';
import { Blend, Sale } from '../lib/types';
import { AssumptionEntry } from '../lib/stockcounter';
import { UploadLogEvent } from '../lib/feed';
import {
  BLENDS_SEED,
  ASSUMPTIONS_SEED,
  STRATEGY_MAPPING_SEED,
  BATCH_MAPPINGS_SEED,
  ASSIGNMENT_HISTORY_SEED,
} from '../seed';

/**
 * Data-API access shared by the skills.
 *
 * Collections:
 *  - `snapshots`         one doc per position date: parsed inputs (compact) + computed results
 *  - `blends`            blend recipes (seeded, extendable)
 *  - `assumptions`       processing-yield assumptions (STRATEGY // GRADE)
 *  - `strategy_mappings` standard strategy → raw spellings
 *  - `batch_mappings`    batch id → standard strategy override
 *  - `forecast_percentages` trader overrides per (strategy|batchPrefix) row (global, like the counter's localStorage)
 *  - `blend_assignments` learned sale→blend memory, one doc per (client|grade|strategy) key
 *  - `pending_blends`    sales awaiting a trader's blend confirmation
 *  - `manual_inputs`     futures pots + certificate positions per date
 *  - `config`            unit constants + horizon rule (editable)
 *  - `upload_log`        append-only audit trail of ingest events (never upserted)
 */

export const COLLECTIONS = {
  snapshots: 'snapshots',
  snapshotInputs: 'snapshot_inputs',
  blends: 'blends',
  assumptions: 'assumptions',
  strategyMappings: 'strategy_mappings',
  batchMappings: 'batch_mappings',
  forecastPercentages: 'forecast_percentages',
  blendAssignments: 'blend_assignments',
  pendingBlends: 'pending_blends',
  manualInputs: 'manual_inputs',
  config: 'config',
  uploadLog: 'upload_log',
} as const;

/** Read every entry of a collection (paginates; collections here are small). */
export async function getAll(collection: string, filter?: any): Promise<Array<{ id: string; data: any }>> {
  const out: Array<{ id: string; data: any }> = [];
  let page = 1;
  for (;;) {
    const res = await Data.get(collection, filter, page, 100);
    const rows = res?.data ?? [];
    out.push(...rows.map((r: any) => ({ id: r.id, data: r.data ?? r })));
    const totalPages = (res as any)?.pagination?.totalPages;
    if (rows.length < 100 || (totalPages && page >= totalPages)) break;
    page++;
  }
  return out;
}

/** Create-or-update the single entry matching `filter`. */
export async function upsert(collection: string, filter: any, data: Record<string, any>, searchText?: string) {
  const existing = await Data.get(collection, filter, 1, 1);
  const hit = existing?.data?.[0];
  if (hit?.id) return Data.update(collection, hit.id, data, searchText);
  return Data.create(collection, { ...filter, ...data }, searchText);
}

/**
 * Upsert the current pending blends for a date, then DELETE pending_blends
 * docs for sales no longer pending (departed on a re-upload) — otherwise the
 * collection keeps ghost confirmations forever. confirm-blend's per-sale
 * delete and delete-snapshot's whole-date purge stay separate.
 */
export async function reconcilePendingBlends(positionDate: string, pending: Array<Record<string, any>>): Promise<void> {
  for (const p of pending) {
    await upsert(COLLECTIONS.pendingBlends, { positionDate: p.positionDate, saleCtr: p.saleCtr }, p, `pending blend ${p.saleCtr} ${p.client}`);
  }
  const keep = new Set(pending.map((p) => p.saleCtr));
  const docs = await getAll(COLLECTIONS.pendingBlends, { positionDate });
  for (const doc of docs) {
    if (doc?.id && !keep.has(doc.data?.saleCtr)) await Data.delete(COLLECTIONS.pendingBlends, doc.id);
  }
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface Snapshot {
  positionDate: string; // YYYY-MM-DD
  [key: string]: any;
}

/**
 * The three ingested inputs live in their OWN docs, one per (positionDate,
 * kind) — NOT inside the shared snapshot doc. Root cause (prod, 2026-07-10):
 * the model fires all three ingest tools in parallel when the trader drops
 * three files in one message, and concurrent read-modify-write upserts on one
 * doc lost the DNP patch. Distinct upsert filters never contend, so parallel
 * ingestion is race-free by construction. Computed results (theoretical /
 * forwardSales / net / futs / …) stay on the snapshot doc — the compute chain
 * is sequential.
 */
const INPUT_KINDS = ['stock', 'dnp', 'sales'] as const;

/** Merge duplicate docs for one date (older race could create several), oldest first so the newest write wins per key. */
function mergeDocs(docs: Array<{ id: string; data: any }>): { id: string; data: any } | null {
  if (docs.length === 0) return null;
  docs.sort((a, b) => String(a.data?.updatedAt ?? '').localeCompare(String(b.data?.updatedAt ?? '')));
  const data = Object.assign({}, ...docs.map((d) => d.data));
  return { id: docs[docs.length - 1].id, data };
}

/** Get the snapshot for a date (computed doc + input docs assembled), or the most recent one when no date given. */
export async function getSnapshot(positionDate?: string): Promise<{ id: string; data: Snapshot } | null> {
  if (!positionDate) {
    const dates = new Set<string>();
    for (const row of await getAll(COLLECTIONS.snapshots)) if (row.data?.positionDate) dates.add(String(row.data.positionDate));
    for (const row of await getAll(COLLECTIONS.snapshotInputs)) if (row.data?.positionDate) dates.add(String(row.data.positionDate));
    if (dates.size === 0) return null;
    positionDate = [...dates].sort().pop()!;
  }
  const computed = mergeDocs(await getAll(COLLECTIONS.snapshots, { positionDate }));
  const inputs = await getAll(COLLECTIONS.snapshotInputs, { positionDate });
  if (!computed && inputs.length === 0) return null;
  const data: Snapshot = { positionDate, ...(computed?.data ?? {}) };
  let updatedAt = String(computed?.data?.updatedAt ?? '');
  for (const row of inputs) {
    // input docs are authoritative over legacy embedded stock/dnp/sales keys
    data[row.data.kind] = row.data.payload;
    if (String(row.data.updatedAt ?? '') > updatedAt) updatedAt = String(row.data.updatedAt);
  }
  if (updatedAt) data.updatedAt = updatedAt;
  return { id: computed?.id ?? inputs[0].id, data };
}

/** Delete a stored snapshot (computed doc + input docs, duplicates included). Returns false if none existed. */
export async function deleteSnapshot(positionDate: string): Promise<boolean> {
  const docs = [
    ...(await getAll(COLLECTIONS.snapshots, { positionDate })).map((d) => ({ collection: COLLECTIONS.snapshots, id: d.id })),
    ...(await getAll(COLLECTIONS.snapshotInputs, { positionDate })).map((d) => ({ collection: COLLECTIONS.snapshotInputs, id: d.id })),
  ];
  for (const d of docs) await Data.delete(d.collection, d.id);
  return docs.length > 0;
}

/**
 * A REAL upload landing on a date whose snapshot is the demo seed must start
 * that date FRESH — snapshot writes merge, so ingesting into a demo snapshot
 * would otherwise serve a hybrid (e.g. real stock + demo sales and a stale
 * demo label; seen in prod UI testing 2026-07-10). Returns true if a demo
 * snapshot was cleared.
 */
export async function clearDemoSnapshot(positionDate: string): Promise<boolean> {
  const demoDocs = (await getAll(COLLECTIONS.snapshots, { positionDate })).filter((d) => d.data?.demo === true);
  if (demoDocs.length === 0) return false;
  for (const d of demoDocs) await Data.delete(COLLECTIONS.snapshots, d.id);
  // the demo day's input docs must go too, or a real upload onto this date
  // would assemble a hybrid of real + demo inputs
  for (const d of await getAll(COLLECTIONS.snapshotInputs, { positionDate })) await Data.delete(COLLECTIONS.snapshotInputs, d.id);
  return true;
}

/**
 * Merge `patch` into the snapshot for `positionDate`, creating it if needed.
 * Input keys (stock / dnp / sales) are routed to their per-kind docs; every
 * other key goes to the shared computed doc. Callers are unchanged.
 */
export async function saveSnapshot(positionDate: string, patch: Record<string, any>): Promise<void> {
  const updatedAt = new Date().toISOString();
  const rest: Record<string, any> = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((INPUT_KINDS as readonly string[]).includes(key)) {
      await upsert(
        COLLECTIONS.snapshotInputs,
        { positionDate, kind: key },
        { positionDate, kind: key, payload: value, updatedAt },
        `snapshot input ${key} ${positionDate}`
      );
    } else {
      rest[key] = value;
    }
  }
  if (Object.keys(rest).length > 0) {
    await upsert(
      COLLECTIONS.snapshots,
      { positionDate },
      { ...rest, positionDate, updatedAt },
      `position snapshot ${positionDate}`
    );
  }
}

/** One line per stored date: which inputs/results are present (assembled across both collections). */
export async function listSnapshotSummaries(): Promise<
  Array<{ positionDate: string; has: Record<string, boolean>; updatedAt?: string }>
> {
  const dates = new Set<string>();
  for (const row of await getAll(COLLECTIONS.snapshots)) if (row.data?.positionDate) dates.add(String(row.data.positionDate));
  for (const row of await getAll(COLLECTIONS.snapshotInputs)) if (row.data?.positionDate) dates.add(String(row.data.positionDate));
  const out = [];
  for (const positionDate of [...dates].sort().reverse()) {
    const snap = await getSnapshot(positionDate);
    const d: Snapshot = snap?.data ?? { positionDate };
    out.push({
      positionDate,
      has: {
        stock: !!d.stock,
        dailyNetPosition: !!d.dnp,
        sales: !!d.sales,
        theoretical: !!d.theoretical,
        forwardSales: !!d.forwardSales,
        netPosition: !!d.net,
        futsSpread: !!d.futs,
      },
      updatedAt: d.updatedAt,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Upload log (append-only audit trail)
// ---------------------------------------------------------------------------

/** True if an input doc already exists for (positionDate, kind) — read BEFORE saveSnapshot to detect overwrites. */
export async function inputDocExists(positionDate: string, kind: string): Promise<boolean> {
  const res = await Data.get(COLLECTIONS.snapshotInputs, { positionDate, kind }, 1, 1);
  return (res?.data ?? []).length > 0;
}

/**
 * Refuse an export that parsed to zero data rows — an empty/corrupt
 * (re-)upload must never wipe a good book. Call after parsing + date
 * resolution and BEFORE any write, so a refusal persists nothing and logs no
 * upload event.
 */
export async function refuseEmptyIngest(exportLabel: string, kind: 'stock' | 'dnp' | 'sales', rowCount: number, positionDate: string): Promise<void> {
  if (rowCount > 0) return;
  const existing = await inputDocExists(positionDate, kind);
  throw new Error(
    `${exportLabel} parsed to 0 data rows — refusing to ingest an empty ${kind} book for ${positionDate}` +
      (existing ? ` (a ${kind} upload already exists for this date and would have been wiped)` : '') +
      `. Check the file is the right export; if the desk genuinely means to clear this date, use delete-snapshot instead.`
  );
}

/**
 * Append one upload event to the audit trail. Always Data.create — a
 * re-upload adds a second event instead of replacing the first, and
 * delete-snapshot never touches this collection (an audit trail that forgets
 * deletions isn't one). A log failure must never fail the ingest itself.
 */
export async function logUpload(event: UploadLogEvent): Promise<void> {
  try {
    await Data.create(COLLECTIONS.uploadLog, event, `upload ${event.kind} ${event.positionDate}`);
  } catch (err) {
    console.error('upload_log write failed (ingest unaffected)', err);
  }
}

/** Every upload event on file, newest first. */
export async function listUploadEvents(): Promise<UploadLogEvent[]> {
  const rows = await getAll(COLLECTIONS.uploadLog);
  return rows
    .map((r) => r.data as UploadLogEvent)
    .filter((e) => e?.at && e?.kind && e?.positionDate)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// ---------------------------------------------------------------------------
// Reference data (seeded collections, with bundled-seed fallback)
// ---------------------------------------------------------------------------

export async function loadBlendRecipes(): Promise<Blend[]> {
  const rows = await getAll(COLLECTIONS.blends);
  const source = rows.length > 0 ? rows.map((r) => r.data) : (BLENDS_SEED.blends as any[]);
  return source
    .filter((b: any) => b.blendNo != null)
    .map((b: any) => ({
      blendNo: Number(b.blendNo),
      client: b.client ?? null,
      grade: b.grade ?? null,
      cupProfile: b.cupProfile ?? null,
      recipe: b.recipe ?? {},
    }));
}

export async function loadAssumptions(): Promise<Record<string, AssumptionEntry>> {
  const rows = await getAll(COLLECTIONS.assumptions);
  if (rows.length === 0) return ASSUMPTIONS_SEED.ASSUMPTIONS as unknown as Record<string, AssumptionEntry>;
  const out: Record<string, AssumptionEntry> = {};
  for (const r of rows) out[r.data.key] = { percentToProcess: r.data.percentToProcess, outputs: r.data.outputs };
  return out;
}

export async function loadStrategyMapping(): Promise<Record<string, string[]>> {
  const rows = await getAll(COLLECTIONS.strategyMappings);
  if (rows.length === 0) return STRATEGY_MAPPING_SEED;
  const out: Record<string, string[]> = {};
  for (const r of rows) out[r.data.standard] = r.data.raws ?? [];
  return out;
}

export async function loadBatchMappings(): Promise<Record<string, string>> {
  const rows = await getAll(COLLECTIONS.batchMappings);
  if (rows.length === 0) return BATCH_MAPPINGS_SEED;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.data.batchId] = r.data.standard;
  return out;
}

/** Trader percentage overrides per matrix row key (global, like the counter's localStorage). */
export async function loadForecastOverrides(): Promise<Record<string, Record<string, number>>> {
  const rows = await getAll(COLLECTIONS.forecastPercentages);
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) out[r.data.rowKey] = r.data.percentages ?? {};
  return out;
}

// ---------------------------------------------------------------------------
// Blend assignment memory
// ---------------------------------------------------------------------------

/** Load the learned memory (one collection doc per key), seeding from bundled history if empty. */
export async function loadAssignmentMemory(): Promise<AssignmentMemory> {
  const rows = await getAll(COLLECTIONS.blendAssignments);
  if (rows.length > 0) {
    const mem: AssignmentMemory = {};
    for (const r of rows) mem[r.data.key] = r.data.counts ?? {};
    return mem;
  }
  // fall back to the bundled golden-day history
  const mem: AssignmentMemory = {};
  for (const s of ASSIGNMENT_HISTORY_SEED as unknown as Sale[]) {
    if (s.blendNo == null) continue;
    const key = [s.client ?? '', s.sGrade ?? '', s.sStrategy ?? '']
      .map((x) => String(x).toUpperCase().replace(/\s+/g, ' ').trim())
      .join('|');
    (mem[key] ||= {})[s.blendNo] = (mem[key][s.blendNo] || 0) + 1;
  }
  return mem;
}

/** Persist one confirmed assignment (increments the key's count for that blend). */
export async function persistAssignment(key: string, blendNo: number): Promise<void> {
  const res = await Data.get(COLLECTIONS.blendAssignments, { key }, 1, 1);
  const hit = res?.data?.[0];
  const counts = hit?.data?.counts ?? {};
  counts[blendNo] = (counts[blendNo] || 0) + 1;
  if (hit?.id) await Data.update(COLLECTIONS.blendAssignments, hit.id, { counts });
  else await Data.create(COLLECTIONS.blendAssignments, { key, counts }, `blend assignment ${key}`);
}

// ---------------------------------------------------------------------------
// Chat-upload fallback
// ---------------------------------------------------------------------------

/** Matches the manifest the spreadsheet-intake preprocessor injects (`fileId=<id>;`). */
const MANIFEST_FILE_ID = /\bfileId=([^;\s\]]+);/;

/**
 * Resolve a file reference: use the explicit id when given, else scan the
 * chat history for the most recent upload — either a raw file part or the
 * `[Spreadsheet received … fileId=…;]` manifest the spreadsheet-intake
 * preprocessor swaps in for spreadsheet attachments.
 */
export async function resolveFileId(fileId?: string): Promise<string> {
  if (fileId && fileId.trim()) return fileId.trim();
  const history = await User.getChatHistory();
  for (let i = history.length - 1; i >= 0; i--) {
    const content = (history[i] as any).content ?? [];
    for (let j = content.length - 1; j >= 0; j--) {
      const part = content[j];
      if (part?.type === 'file' || part?.type === 'image') {
        const ref = part.data ?? part.fileId ?? part.url ?? part.file;
        if (typeof ref === 'string' && ref) return ref;
      }
      if (part?.type === 'text' && typeof part.text === 'string') {
        const m = MANIFEST_FILE_ID.exec(part.text);
        if (m) return m[1];
      }
    }
  }
  throw new Error('No file reference provided and no uploaded file found in the conversation — please upload the export.');
}

/** Today's date in Nairobi, YYYY-MM-DD — the default position date. */
export function defaultPositionDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}
