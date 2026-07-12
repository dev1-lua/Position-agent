# Uploads Tracker — session summary (2026-07-13)

What was designed, built and verified for the new **Uploads** section of the dashboard: a
status board + audit log of the three desk exports (XBS Current Stock, SOL DailyNetPosition,
SOL ReportLogistic). Full design rationale lives in
`docs/superpowers/specs/2026-07-13-uploads-tracker-design.md` (committed as `e49d746`).

## The problem

- Ingestion kept only **latest state**: one `snapshot_inputs` doc per (positionDate, kind),
  overwritten on re-upload. No history of what got uploaded when.
- The dashboard SPA had **no data access at all** — it only embeds the LuaPop chat widget.
- No at-a-glance answer to "is today's position built on fresh data?"

## Decisions made (brainstormed + approved section-by-section)

| Question | Decision |
|---|---|
| Tracker type | Status board **and** append-only audit log |
| Upload entry | View-only — uploads keep flowing through chat (drag-drop = possible phase 2) |
| Placement | New **Uploads** sidebar section at `/uploads` (Dashboard stays reserved for analytics) |
| Hero | Today's data health — three file slots, Fresh / Stale / Missing |
| Motion | Framer Motion micro-interactions, kept Twenty-quiet |

## Architecture

```
chat upload → preprocessor (CDN + sniff) → ingest tool
                                             ├─ snapshot_inputs  (latest state, unchanged)
                                             └─ upload_log       (NEW, append-only event)

dashboard SPA → GET /api/feed (Vercel edge fn, holds secret)
             → POST https://webhook.heylua.ai/{agentId}/dashboard-feed
             → assembles feed from Data collections
```

### 1. `upload_log` collection — the "database" of the 3 files

One doc per successful ingest, written by each ingest tool after `saveSnapshot()`.
Always `Data.create`, never upserted — a re-upload adds a second event instead of
replacing the first.

```ts
{ at, kind: 'stock'|'dnp'|'sales', positionDate, fileId, rowCount,
  dateSource, warnings[], overwrote, coverage? }
```

- `fileId` is the CDN id → every historical raw file stays retrievable.
- `overwrote` is detected by checking the (date, kind) input doc **before** `saveSnapshot()`.
- A log-write failure never fails the ingest (caught + warned).
- `delete-snapshot` does **not** touch the log — an audit trail that forgets deletions
  isn't one; the feed marks such dates `deleted` instead.
- No backfill: history starts at ship; older dates still show in the grid from
  `snapshot_inputs`, just without events.

### 2. `dashboard-feed` webhook (read path)

- Requires `secret` in the POST body matching the `DASHBOARD_FEED_SECRET` agent env var;
  refuses when unconfigured. Wrong/missing → `{ error: 'unauthorized' }`.
- Payload: `today` (Nairobi date + 3 slots with status/ageDays/rowCount/warnings),
  `dates` (per-date summaries + per-kind event counts + deleted flags),
  `events` (last 50, newest first, coverage stripped).
- Staleness language mirrors the chat's citeLine ("N days old — latest upload on file").
- Already created on the server by `lua compile` — ID `e5f6199d-8b5f-4dfa-aa14-0a7d5451c220`.

### 3. Vercel proxy

`dashboard/api/feed.ts` (edge runtime): SPA fetches `GET /api/feed`; the function POSTs to
the webhook with the secret from Vercel env. Secret never ships in the client bundle (same
rule as `SITE_PASSWORD`). Filesystem functions beat the SPA rewrite, so `/api/feed`
coexists with `vercel.json`'s catch-all. Site-password middleware still gates it.

### 4. UI — Uploads section

- **TodayHealth (hero):** 3 slot cards (XBS Stock / SOL Net Position / SOL Sales) — status
  dot + chip (Fresh green / Stale amber / Missing red-pulse), last upload time, row count,
  collapsible warnings.
- **HistoryGrid:** one row per position date, newest first — 3 per-kind cells, computed
  check, "×N" re-upload badge, struck-through + `deleted` chip for removed dates.
- **ActivityFeed:** last ~50 events, expandable to date source, warnings, and the file
  reference (link when the id is a URL, copy-to-clipboard otherwise).
- Loading skeletons; a downed feed shows an explicit "Upload feed unreachable" state with
  Retry — never renders empty-but-healthy.
- Framer Motion: staggered entrances (22 ms rise, easeOut), pulsing Missing dot, smooth
  height expand/collapse; `MotionConfig reducedMotion="user"` respected.

## Files touched

**New — agent (backend)**
- `src/lib/feed.ts` — feed types + pure `assembleFeed()` (unit-testable, no Data API)
- `src/webhooks/dashboardFeed.ts` — the `dashboard-feed` LuaWebhook
- `src/__tests__/feed.ts` — 22 assembly tests (`npx tsx src/__tests__/feed.ts`)

**Modified — agent**
- `src/skills/store.ts` — `uploadLog` collection, `logUpload()`, `inputDocExists()`,
  `listUploadEvents()`
- `src/skills/ingestion.skill.ts` — all 3 ingest tools log an event after `saveSnapshot()`
  (coverage/warnings hoisted into shared consts)
- `src/index.ts` — `webhooks: [dashboardFeed]`
- `lua.skill.yaml` — synced by compile (webhook registered)

**New — dashboard (frontend)**
- `dashboard/api/feed.ts` — Vercel edge proxy
- `dashboard/src/lib/useFeed.ts` — fetch hook + payload types (treats non-JSON as
  feed-unreachable, e.g. plain `vite dev`)
- `dashboard/src/pages/UploadsPage.tsx` — layout, skeletons, error state
- `dashboard/src/components/uploads/shared.tsx` — kind labels, Nairobi time formatting,
  StatusDot, motion variants
- `dashboard/src/components/uploads/TodayHealth.tsx`
- `dashboard/src/components/uploads/HistoryGrid.tsx`
- `dashboard/src/components/uploads/ActivityFeed.tsx`

**Modified — dashboard**
- `dashboard/src/components/layout/Sidebar.tsx` — Uploads nav item (IconDatabaseImport)
- `dashboard/src/App.tsx` — `/uploads` route
- `dashboard/package.json` — `framer-motion` dependency

## Verification done

- `src/__tests__/feed.ts`: **22/22 pass** — staleness math (incl. Nairobi-midnight and
  future-dated snapshots), fresh/stale/missing slots, event-vs-summary fallbacks, deleted
  dates, ×N re-upload counts, 50-event cap, coverage stripping.
- Parity harness (`src/__tests__/parity.ts`): **still passes** after the ingestion changes.
- `lua compile --ci`: green — 32 primitives (1 agent, 5 skills, 23 tools, 1 webhook, 1 job,
  1 preprocessor); webhook created server-side.
- Dashboard `tsc --noEmit` + `vite build`: green.
- Playwright against `vite dev` with a mocked `/api/feed`: happy path, expanded
  warnings/feed rows, and error+retry state all screenshot-verified. (One bug found and
  fixed this way: the stale card's status line truncated the date — now wraps.)

## Still to do (deploy — user-gated)

1. **Commit the code.** The spec is committed (`e49d746`); the code is not, because the
   working tree already carried uncommitted changes from earlier work (`src/index.ts`,
   `lua.skill.yaml`, insights files…) that need splitting task-wise.
2. **Agent:** set `DASHBOARD_FEED_SECRET` (any long random string) as an agent env var,
   then `lua push` + deploy.
3. **Vercel:** set `FEED_WEBHOOK_URL=https://webhook.heylua.ai/{agentId}/dashboard-feed`
   and the same `DASHBOARD_FEED_SECRET`; redeploy the dashboard.
4. **Smoke test:** upload an export in chat → event appears in the feed; re-upload the same
   file → second event with `overwrote: true` and the ×2 badge in the grid.
