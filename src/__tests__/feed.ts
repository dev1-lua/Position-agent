/**
 * Dashboard-feed assembly test — pure-function checks for lib/feed
 * (today's slot statuses, staleness math, deleted dates, re-upload counts,
 * event cap + coverage stripping). No Data API involved.
 *
 * Run: `npx tsx src/__tests__/feed.ts`
 */
import { assembleFeed, daysBetween, SnapshotSummary, UploadLogEvent } from '../lib/feed';

let failed = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};

const ev = (over: Partial<UploadLogEvent>): UploadLogEvent => ({
  at: '2026-07-13T06:00:00.000Z',
  kind: 'stock',
  positionDate: '2026-07-13',
  fileId: 'file-1',
  rowCount: 100,
  dateSource: 'derived from export rows',
  warnings: [],
  overwrote: false,
  ...over,
});

// --- daysBetween ------------------------------------------------------------
check('daysBetween same day = 0', daysBetween('2026-07-13', '2026-07-13') === 0);
check('daysBetween 3 days', daysBetween('2026-07-10', '2026-07-13') === 3);
check('daysBetween across month end', daysBetween('2026-06-30', '2026-07-01') === 1);

// --- fresh / stale / missing slots -------------------------------------------
const summaries: SnapshotSummary[] = [
  {
    positionDate: '2026-07-13',
    has: { stock: true, dailyNetPosition: false, sales: false, theoretical: true },
    updatedAt: '2026-07-13T06:00:00.000Z',
  },
  {
    positionDate: '2026-07-10',
    has: { stock: true, dailyNetPosition: true, sales: false },
    updatedAt: '2026-07-10T07:00:00.000Z',
  },
];
const events: UploadLogEvent[] = [
  ev({ at: '2026-07-13T06:01:00.000Z', kind: 'stock', positionDate: '2026-07-13', rowCount: 754, warnings: ['w1'], coverage: { blocked: { rows: 1, bags: 2 } } }),
  ev({ at: '2026-07-10T07:00:00.000Z', kind: 'dnp', positionDate: '2026-07-10', rowCount: 459 }),
];

const feed = assembleFeed('2026-07-13', summaries, events);
check('today positionDate', feed.today.positionDate === '2026-07-13');
check('stock slot fresh', feed.today.slots.stock.status === 'fresh');
check('stock slot rowCount from event', feed.today.slots.stock.rowCount === 754);
check('stock slot warnings from event', feed.today.slots.stock.warnings?.[0] === 'w1');
check('dnp slot stale', feed.today.slots.dnp.status === 'stale', `got ${feed.today.slots.dnp.status}`);
check('dnp slot ageDays 3', feed.today.slots.dnp.ageDays === 3);
check('dnp slot dated at latest dnp day', feed.today.slots.dnp.positionDate === '2026-07-10');
check('sales slot missing', feed.today.slots.sales.status === 'missing');
check('feed events strip coverage', !('coverage' in feed.events[0]));
check('feed events newest first', feed.events[0].at === '2026-07-13T06:01:00.000Z');

// slot falls back to summary updatedAt when no event exists for that date
const noEventFeed = assembleFeed('2026-07-13', summaries, []);
check('slot at falls back to summary updatedAt', noEventFeed.today.slots.stock.at === '2026-07-13T06:00:00.000Z');
check('slot rowCount absent without event', noEventFeed.today.slots.stock.rowCount === undefined);

// --- deleted dates + re-upload counts ----------------------------------------
const delEvents: UploadLogEvent[] = [
  ev({ at: '2026-07-08T05:00:00.000Z', positionDate: '2026-07-08' }),
  ev({ at: '2026-07-08T09:00:00.000Z', positionDate: '2026-07-08' }), // re-upload
  ev({ at: '2026-07-01T05:00:00.000Z', positionDate: '2026-07-01' }), // snapshot since deleted
];
const feed2 = assembleFeed('2026-07-13', [{ positionDate: '2026-07-08', has: { stock: true } }], delEvents);
const jul8 = feed2.dates.find((d) => d.positionDate === '2026-07-08');
const jul1 = feed2.dates.find((d) => d.positionDate === '2026-07-01');
check('re-upload count ×2', jul8?.eventCounts.stock === 2);
check('existing date not deleted', !jul8?.deleted);
check('event-only date marked deleted', jul1?.deleted === true);
check('dates newest first', feed2.dates[0].positionDate === '2026-07-08');

// --- event cap ---------------------------------------------------------------
const many = Array.from({ length: 60 }, (_, i) =>
  ev({ at: `2026-07-13T06:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z` })
);
const feed3 = assembleFeed('2026-07-13', [], many);
check('events capped at 50', feed3.events.length === 50, `got ${feed3.events.length}`);
check('all 60 counted for badges', feed3.dates[0]?.eventCounts.stock === 60);

// --- future-dated snapshot never reads as stale --------------------------------
const future = assembleFeed('2026-07-13', [{ positionDate: '2026-07-14', has: { stock: true } }], []);
check('future date reads fresh, ageDays 0', future.today.slots.stock.status === 'fresh' && future.today.slots.stock.ageDays === 0);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
