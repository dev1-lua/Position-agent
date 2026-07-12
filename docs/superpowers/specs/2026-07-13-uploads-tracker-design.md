# Uploads Tracker — design

**Date:** 2026-07-13 · **Status:** approved (brainstormed section-by-section with the trader-facing owner)

## Problem

The trader uploads three desk exports through the chat (XBS Current Stock, SOL DailyNetPosition, SOL ReportLogistic). Ingestion keeps only *latest state* — one `snapshot_inputs` doc per (positionDate, kind), overwritten on re-upload — so there is no record of what got uploaded when, and no way to see at a glance whether today's position is built on fresh data. The dashboard frontend has no data access at all (it only embeds the chat widget).

## Decision summary

- **Tracker type:** status board **and** audit log (not either/or).
- **Entry point:** view-only for now — uploads keep flowing through chat; drag-drop is a possible phase 2.
- **Placement:** new **Uploads** sidebar section (`/uploads`); Dashboard stays reserved for analytics.
- **Hero:** today's data health — three file slots answering "is today's position built on fresh data?"
- **Motion:** Framer Motion micro-interactions, kept Twenty-quiet.

## Architecture

```
chat upload → preprocessor (CDN + sniff) → ingest tool
                                             ├─ snapshot_inputs (latest state, unchanged)
                                             └─ upload_log (NEW, append-only event)

dashboard SPA → /api/feed (Vercel fn, holds secret) → dashboard-feed webhook → Data collections
```

### 1. `upload_log` collection (the "database" of the 3 files)

One doc per successful ingest, written by each ingest tool after `saveSnapshot()`. Always `Data.create` — never upserted, so re-uploads add a second event instead of replacing the first.

```ts
{
  at: string,            // ISO timestamp of the ingest
  kind: 'stock' | 'dnp' | 'sales',
  positionDate: string,  // YYYY-MM-DD the data landed on
  fileId: string,        // CDN id — raw file stays retrievable forever
  rowCount: number,
  dateSource: string,    // how the position date was determined
  warnings: string[],    // drift warnings from ingest
  overwrote: boolean,    // an input doc for (date, kind) already existed
  coverage?: object      // the coverage report the tool already computes (stock, sales)
}
```

Rules:
- A log-write failure must never fail an ingest (warn and continue).
- `delete-snapshot` does **not** delete log events — an audit trail that forgets deletions isn't one. The feed marks dates whose snapshot is gone as deleted.
- No backfill: history starts at ship; older dates still appear in the grid from `snapshot_inputs`, just without events.

### 2. `dashboard-feed` webhook (read path)

`LuaWebhook` named `dashboard-feed` → `https://webhook.heylua.ai/{agentId}/dashboard-feed` (POST). Body must carry a `secret` matching the `DASHBOARD_FEED_SECRET` env var; otherwise `{ error: 'unauthorized' }`. Assembly logic lives in a pure function (`src/lib/feed.ts`) for unit testing. Payload:

```ts
{
  today: { positionDate, slots: { stock, dnp, sales } },
    // slot: { present, at?, rowCount?, warnings?, ageDays? }
    // staleness language mirrors citeLine ("N days old — latest upload on file")
  dates: [ { positionDate, has: {...}, updatedAt, deleted? } ],
  events: [ ...last 50 upload_log docs, newest first ]
}
```

"Today" and staleness use Nairobi time (same rule as `defaultPositionDate()`).

### 3. Vercel proxy

`dashboard/api/feed.ts` serverless function: POSTs to the webhook with the secret from Vercel env (`DASHBOARD_FEED_SECRET`, `FEED_WEBHOOK_URL` — server-side only, never `VITE_`-prefixed, same rule as `SITE_PASSWORD`). The SPA fetches `/api/feed`; no secret ever ships in the client bundle. Vercel serves filesystem functions before the SPA rewrite, so `/api/feed` coexists with the catch-all in `vercel.json`.

### 4. UI — Uploads section

Twenty CRM design language (gray canvas, floating white panel, no accent fills), Framer Motion for entrance/expand animations (short durations, small distances, no bouncy springs).

- **TodayHealth (hero):** three slot cards — XBS Stock / SOL Net Position / SOL Sales — each with status dot + word (**Fresh** / **Stale** "N days old — latest upload on file" / **Missing**), last upload time, row count, collapsible warnings.
- **HistoryGrid:** one row per position date, newest first: date, three per-kind cells (✓ + time / —), computed-results check, "re-uploaded ×N" badge when a cell has multiple events, struck-through for deleted dates.
- **ActivityFeed:** last ~50 events ("Jul 13, 09:14 — XBS stock → 2026-07-13, 754 rows, 2 warnings"), expandable to warnings + CDN file link. Right column, stacks below on narrow viewports.
- Loading skeletons; an unreachable feed shows an explicit error state with retry — never renders empty as if healthy.

## Testing

- Unit: feed assembly from seeded collections → expected JSON; staleness across Nairobi midnight; `logUpload` failure isolation.
- `lua test --ci` on the webhook (secret accept/reject).
- E2E smoke: sandbox upload → event appears; re-upload → `overwrote: true` + ×2 badge.

## Ship order

1. this spec (committed) → 2. backend (log + webhook, compile + tests) → 3. deploy agent → 4. Vercel fn + env vars → 5. UI.
