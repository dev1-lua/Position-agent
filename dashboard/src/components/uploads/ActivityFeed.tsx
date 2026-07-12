import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconAlertTriangle, IconCopy, IconCheck } from '@tabler/icons-react';

import { cn } from '@/lib/cn';
import type { FeedEvent } from '@/lib/useFeed';
import { KIND_LABEL, formatDay, formatTime, rise, stagger } from './shared';

/** fileId is a CDN reference; only some deployments hand back a URL. */
function FileRef({ fileId }: { fileId: string }) {
  const [copied, setCopied] = useState(false);
  if (/^https?:\/\//i.test(fileId)) {
    return (
      <a href={fileId} target="_blank" rel="noreferrer" className="text-xs underline decoration-border underline-offset-2 hover:text-foreground">
        original file
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(fileId).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      title={fileId}
    >
      {copied ? <IconCheck className="size-3 text-emerald-600" stroke={2} /> : <IconCopy className="size-3" stroke={1.6} />}
      file id
    </button>
  );
}

function EventRow({ event }: { event: FeedEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.li variants={rise} className="border-b border-border last:border-b-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-black/[0.02]">
        <span className="flex items-center gap-2 text-xs">
          <span className="font-medium">{KIND_LABEL[event.kind]}</span>
          <span className="text-muted-foreground">→ {formatDay(event.positionDate)}</span>
          {event.overwrote && (
            <span className="rounded-sm border border-amber-200 bg-amber-50 px-1 py-px text-2xs font-medium text-amber-700">
              re-upload
            </span>
          )}
          {event.warnings.length > 0 && (
            <IconAlertTriangle className="ml-auto size-3.5 shrink-0 text-amber-600" stroke={1.8} />
          )}
        </span>
        <span className="text-2xs text-muted-foreground/70">
          {formatTime(event.at)} · {event.rowCount.toLocaleString()} rows
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 px-3 pb-2.5 text-xs text-muted-foreground">
              <p className="text-2xs text-muted-foreground/70">{event.dateSource}</p>
              {event.warnings.map((w) => (
                <p key={w} className={cn('leading-relaxed', 'text-amber-700')}>
                  {w}
                </p>
              ))}
              <FileRef fileId={event.fileId} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** The audit trail: last ~50 ingest events, newest first, expandable. */
export function ActivityFeed({ events }: { events: FeedEvent[] }) {
  return (
    <section className="flex min-w-0 flex-col">
      <h2 className="text-sm font-medium">Activity</h2>
      {events.length === 0 ? (
        <p className="mt-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
          No upload events recorded yet — the audit log starts with the next ingest.
        </p>
      ) : (
        <motion.ul
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="mt-2 overflow-hidden rounded-md border border-border bg-card shadow-btn"
        >
          {events.map((e) => (
            <EventRow key={`${e.at}-${e.kind}`} event={e} />
          ))}
        </motion.ul>
      )}
    </section>
  );
}
