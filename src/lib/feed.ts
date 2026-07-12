/**
 * Dashboard feed assembly — pure functions turning the stored collections
 * (snapshot summaries + upload_log events) into the JSON the dashboard's
 * Uploads section renders. Kept free of Data-API calls so the whole shape is
 * unit-testable; the dashboard-feed webhook does the fetching.
 */

export type SlotKind = 'stock' | 'dnp' | 'sales';

export const SLOT_KINDS: readonly SlotKind[] = ['stock', 'dnp', 'sales'] as const;

/** One append-only audit-trail entry, written by an ingest tool. */
export interface UploadLogEvent {
  at: string; // ISO timestamp of the ingest
  kind: SlotKind;
  positionDate: string; // YYYY-MM-DD the data landed on
  fileId: string; // CDN id — the raw file stays retrievable
  rowCount: number;
  dateSource: string; // how the position date was determined
  warnings: string[];
  overwrote: boolean; // an input doc for (date, kind) already existed
  coverage?: Record<string, any>; // upload-time coverage report (stock, sales)
}

/** Shape returned by listSnapshotSummaries() in skills/store. */
export interface SnapshotSummary {
  positionDate: string;
  has: Record<string, boolean>;
  updatedAt?: string;
}

export interface FeedSlot {
  status: 'fresh' | 'stale' | 'missing';
  /** Date of the latest data on file for this kind (absent when missing). */
  positionDate?: string;
  /** Whole days between that date and today (0 = fresh). */
  ageDays?: number;
  /** When the latest upload for that date happened (event `at`, else summary updatedAt). */
  at?: string;
  rowCount?: number;
  warnings?: string[];
}

export interface FeedDateRow extends SnapshotSummary {
  /** Snapshot no longer exists but the audit trail has events for it. */
  deleted?: boolean;
  /** Upload-event count per kind for this date (drives the "re-uploaded ×N" badge). */
  eventCounts: Partial<Record<SlotKind, number>>;
}

export interface DashboardFeed {
  today: { positionDate: string; slots: Record<SlotKind, FeedSlot> };
  dates: FeedDateRow[];
  /** Newest first, capped, coverage stripped (fetch stays lean). */
  events: Array<Omit<UploadLogEvent, 'coverage'>>;
}

/** listSnapshotSummaries keys DNP as `dailyNetPosition`; the log uses `dnp`. */
const HAS_KEY: Record<SlotKind, string> = {
  stock: 'stock',
  dnp: 'dailyNetPosition',
  sales: 'sales',
};

const EVENTS_CAP = 50;

/** Whole days from `from` to `to` (YYYY-MM-DD each); 0 when equal. */
export function daysBetween(from: string, to: string): number {
  const parse = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

function slotFor(kind: SlotKind, today: string, summaries: SnapshotSummary[], events: UploadLogEvent[]): FeedSlot {
  const newest = summaries
    .filter((s) => s.has[HAS_KEY[kind]])
    .sort((a, b) => b.positionDate.localeCompare(a.positionDate))[0];
  if (!newest) return { status: 'missing' };
  const ageDays = daysBetween(newest.positionDate, today);
  const latestEvent = events
    .filter((e) => e.kind === kind && e.positionDate === newest.positionDate)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return {
    status: ageDays <= 0 ? 'fresh' : 'stale',
    positionDate: newest.positionDate,
    ageDays: Math.max(0, ageDays),
    at: latestEvent?.at ?? newest.updatedAt,
    ...(latestEvent ? { rowCount: latestEvent.rowCount, warnings: latestEvent.warnings } : {}),
  };
}

/**
 * Assemble the full dashboard feed. `today` is the trading day (Nairobi);
 * summaries come from listSnapshotSummaries(); events are ALL upload_log
 * entries (any order) — counts need the full set, the feed caps its own list.
 */
export function assembleFeed(today: string, summaries: SnapshotSummary[], events: UploadLogEvent[]): DashboardFeed {
  const slots = Object.fromEntries(SLOT_KINDS.map((k) => [k, slotFor(k, today, summaries, events)])) as Record<
    SlotKind,
    FeedSlot
  >;

  // per-(date, kind) event counts, and event dates whose snapshot is gone
  const counts = new Map<string, Partial<Record<SlotKind, number>>>();
  for (const e of events) {
    const c = counts.get(e.positionDate) ?? {};
    c[e.kind] = (c[e.kind] ?? 0) + 1;
    counts.set(e.positionDate, c);
  }
  const known = new Set(summaries.map((s) => s.positionDate));
  const dates: FeedDateRow[] = summaries.map((s) => ({ ...s, eventCounts: counts.get(s.positionDate) ?? {} }));
  for (const [positionDate, eventCounts] of counts) {
    if (!known.has(positionDate)) dates.push({ positionDate, has: {}, deleted: true, eventCounts });
  }
  dates.sort((a, b) => b.positionDate.localeCompare(a.positionDate));

  const feedEvents = [...events]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, EVENTS_CAP)
    .map(({ coverage: _coverage, ...rest }) => rest);

  return { today: { positionDate: today, slots }, dates, events: feedEvents };
}
