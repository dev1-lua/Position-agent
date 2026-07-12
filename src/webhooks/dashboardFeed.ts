import { LuaWebhook, env } from 'lua-cli';
import { assembleFeed } from '../lib/feed';
import { defaultPositionDate, listSnapshotSummaries, listUploadEvents } from '../skills/store';

/**
 * Read-only JSON feed for the dashboard's Uploads section: today's data
 * health (3 file slots), per-date snapshot summaries and the upload audit
 * log. The dashboard never calls this directly — a Vercel function
 * (dashboard/api/feed.ts) holds the shared secret and proxies, so the secret
 * never ships in a client bundle.
 *
 * POST https://webhook.heylua.ai/{agentId}/dashboard-feed  { "secret": "…" }
 */
export const dashboardFeed = new LuaWebhook({
  name: 'dashboard-feed',
  description:
    "Read-only JSON feed for the dashboard Uploads section: today's data health, per-date snapshot summaries and the upload audit log. Requires the shared secret.",
  execute: async (event) => {
    const secret = env('DASHBOARD_FEED_SECRET');
    const supplied = event.body?.secret ?? event.headers?.['x-feed-secret'];
    // refuse when unconfigured too — an empty secret must not open the feed
    if (!secret || supplied !== secret) return { error: 'unauthorized' };
    const summaries = await listSnapshotSummaries();
    const events = await listUploadEvents();
    return assembleFeed(defaultPositionDate(), summaries, events);
  },
});
