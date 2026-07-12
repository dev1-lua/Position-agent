import { MotionConfig, motion } from 'framer-motion';
import { IconRefresh, IconCloudOff } from '@tabler/icons-react';

import { useFeed } from '@/lib/useFeed';
import { TodayHealth } from '@/components/uploads/TodayHealth';
import { HistoryGrid } from '@/components/uploads/HistoryGrid';
import { ActivityFeed } from '@/components/uploads/ActivityFeed';

function Skeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-2 sm:flex-row">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 flex-1 animate-pulse rounded-md border border-border bg-muted/60" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-md border border-border bg-muted/60" />
    </div>
  );
}

/** The feed being down must look DOWN — never like an empty-but-healthy tracker. */
function FeedError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex max-w-sm flex-col items-center text-center"
      >
        <span className="flex size-10 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
          <IconCloudOff className="size-5" stroke={1.6} />
        </span>
        <h2 className="mt-4 text-sm font-medium">Upload feed unreachable</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium shadow-btn transition-colors hover:bg-muted"
        >
          <IconRefresh className="size-3.5" stroke={1.8} />
          Retry
        </button>
      </motion.div>
    </div>
  );
}

/**
 * Uploads — the tracker for the three desk exports: today's data health
 * (hero), the per-date completeness grid, and the append-only audit trail.
 * View-only: uploads still flow through the Position Agent chat.
 */
export default function UploadsPage() {
  const feedState = useFeed();

  return (
    <MotionConfig reducedMotion="user">
      <div className="h-full overflow-y-auto">
        {feedState.status === 'error' ? (
          <FeedError error={feedState.error} onRetry={feedState.reload} />
        ) : (
          <div className="mx-auto max-w-5xl p-4 sm:p-6">
            {feedState.status === 'loading' ? (
              <Skeleton />
            ) : (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div className="min-w-0 space-y-6">
                  <TodayHealth today={feedState.feed.today} />
                  <HistoryGrid dates={feedState.feed.dates} />
                </div>
                <ActivityFeed events={feedState.feed.events} />
              </div>
            )}
          </div>
        )}
      </div>
    </MotionConfig>
  );
}
