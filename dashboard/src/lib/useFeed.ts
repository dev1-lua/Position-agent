import { useCallback, useEffect, useState } from 'react';

/**
 * Types mirror the dashboard-feed webhook payload (src/lib/feed.ts in the
 * agent repo). The SPA fetches /api/feed — a Vercel function that holds the
 * webhook secret server-side; nothing here ever sees it.
 */

export type SlotKind = 'stock' | 'dnp' | 'sales';

export interface FeedSlot {
  status: 'fresh' | 'stale' | 'missing';
  positionDate?: string;
  ageDays?: number;
  at?: string;
  rowCount?: number;
  warnings?: string[];
}

export interface FeedDateRow {
  positionDate: string;
  has: Record<string, boolean>;
  updatedAt?: string;
  deleted?: boolean;
  eventCounts: Partial<Record<SlotKind, number>>;
}

export interface FeedEvent {
  at: string;
  kind: SlotKind;
  positionDate: string;
  fileId: string;
  rowCount: number;
  dateSource: string;
  warnings: string[];
  overwrote: boolean;
}

export interface DashboardFeed {
  today: { positionDate: string; slots: Record<SlotKind, FeedSlot> };
  dates: FeedDateRow[];
  events: FeedEvent[];
}

type FeedState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; feed: DashboardFeed };

/**
 * A 200 response that parses as JSON is still not necessarily the feed — a
 * misconfigured proxy target can hand back any object. Rendering such a
 * payload crashes every uploads component at once (white screen), so gate on
 * the three top-level fields and fall into the visible error state instead.
 */
function isDashboardFeed(json: unknown): json is DashboardFeed {
  const feed = json as DashboardFeed | null;
  return (
    !!feed &&
    typeof feed === 'object' &&
    typeof feed.today?.positionDate === 'string' &&
    !!feed.today.slots &&
    Array.isArray(feed.dates) &&
    Array.isArray(feed.events)
  );
}

export function useFeed(): FeedState & { reload: () => void } {
  const [state, setState] = useState<FeedState>({ status: 'loading' });

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    void (async () => {
      try {
        const res = await fetch('/api/feed', { headers: { Accept: 'application/json' } });
        // non-JSON means we hit the login page or a plain `vite dev` with no /api
        const text = await res.text();
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error('The upload feed is not reachable from this environment.');
        }
        if (!res.ok || json?.error) throw new Error(String(json?.error ?? `feed returned HTTP ${res.status}`));
        if (!isDashboardFeed(json)) {
          throw new Error('The feed endpoint answered with an unexpected payload — check FEED_WEBHOOK_URL on Vercel.');
        }
        setState({ status: 'ready', feed: json });
      } catch (err) {
        setState({ status: 'error', error: err instanceof Error ? err.message : 'feed unreachable' });
      }
    })();
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}
