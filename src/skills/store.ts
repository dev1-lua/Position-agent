import { Data, User } from 'lua-cli';
import { AssignmentMemory } from '../lib/blends';
import { Blend, Sale } from '../lib/types';
import { AssumptionEntry } from '../lib/stockcounter';
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
 */

export const COLLECTIONS = {
  snapshots: 'snapshots',
  blends: 'blends',
  assumptions: 'assumptions',
  strategyMappings: 'strategy_mappings',
  batchMappings: 'batch_mappings',
  forecastPercentages: 'forecast_percentages',
  blendAssignments: 'blend_assignments',
  pendingBlends: 'pending_blends',
  manualInputs: 'manual_inputs',
  config: 'config',
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

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface Snapshot {
  positionDate: string; // YYYY-MM-DD
  [key: string]: any;
}

/** Get the snapshot for a date, or the most recent one when no date given. */
export async function getSnapshot(positionDate?: string): Promise<{ id: string; data: Snapshot } | null> {
  if (positionDate) {
    const res = await Data.get(COLLECTIONS.snapshots, { positionDate }, 1, 1);
    const hit = res?.data?.[0];
    return hit ? { id: hit.id, data: hit.data as Snapshot } : null;
  }
  const all = await getAll(COLLECTIONS.snapshots);
  if (all.length === 0) return null;
  all.sort((a, b) => String(b.data.positionDate).localeCompare(String(a.data.positionDate)));
  return all[0] as { id: string; data: Snapshot };
}

/** Merge `patch` into the snapshot for `positionDate`, creating it if needed. */
export async function saveSnapshot(positionDate: string, patch: Record<string, any>): Promise<void> {
  await upsert(
    COLLECTIONS.snapshots,
    { positionDate },
    { ...patch, positionDate, updatedAt: new Date().toISOString() },
    `position snapshot ${positionDate}`
  );
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

/**
 * Resolve a file reference: use the explicit id when given, else scan the
 * chat history for the most recent uploaded file (LuaPop upload → CDN;
 * exact wiring is a docs gap — see HANDOVER §7 — so both paths are kept).
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
    }
  }
  throw new Error('No file reference provided and no uploaded file found in the conversation — please upload the export.');
}

/** Today's date in Nairobi, YYYY-MM-DD — the default position date. */
export function defaultPositionDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}
