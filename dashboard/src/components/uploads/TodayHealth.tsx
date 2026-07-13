import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconAlertTriangle, IconChevronDown } from '@tabler/icons-react';

import { cn } from '@/lib/cn';
import type { DashboardFeed, SlotKind } from '@/lib/useFeed';
import { KIND_FILE, KIND_LABEL, KIND_ORDER, StatusDot, formatDay, rise, stagger } from './shared';

const STATUS_WORD = { fresh: 'Fresh', stale: 'Stale', missing: 'Missing' } as const;

function statusLine(slot: DashboardFeed['today']['slots'][SlotKind]): string {
  if (slot.status === 'missing') return 'No upload on file';
  if (slot.status === 'fresh') return `Today's data · ${formatDay(slot.positionDate!)}`;
  // mirrors the chat's citeLine staleness language so both surfaces agree
  return `${slot.ageDays} day${slot.ageDays === 1 ? '' : 's'} old — latest upload on file is ${formatDay(slot.positionDate!)}`;
}

function SlotCard({ kind, slot }: { kind: SlotKind; slot: DashboardFeed['today']['slots'][SlotKind] }) {
  const [showWarnings, setShowWarnings] = useState(false);
  const warnings = slot.warnings ?? [];

  return (
    <motion.div
      variants={rise}
      className="flex min-w-0 flex-1 flex-col rounded-md border border-border bg-card p-3 shadow-btn"
    >
      <div className="flex items-center gap-2">
        <StatusDot status={slot.status} />
        <span className="truncate text-sm font-medium">{KIND_LABEL[kind]}</span>
        <span
          className={cn(
            'ml-auto rounded-sm border px-1.5 py-px text-2xs font-medium',
            slot.status === 'fresh' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
            slot.status === 'stale' && 'border-amber-200 bg-amber-50 text-amber-700',
            slot.status === 'missing' && 'border-red-200 bg-red-50 text-red-600',
          )}
        >
          {STATUS_WORD[slot.status]}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground" title={KIND_FILE[kind]}>
        {statusLine(slot)}
      </p>
      {/* No ingest wall-clock here — "3 days old" is position-date staleness and the
          upload timestamp reads as contradicting it; that lives in History → Last update. */}
      {slot.rowCount != null && (
        <p className="mt-0.5 text-xs text-muted-foreground/70">{slot.rowCount.toLocaleString()} rows</p>
      )}
      {warnings.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setShowWarnings((v) => !v)}
            className="flex w-full items-center gap-1.5 text-xs text-amber-700 hover:text-amber-800"
          >
            <IconAlertTriangle className="size-3.5 shrink-0" stroke={1.8} />
            {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            <motion.span animate={{ rotate: showWarnings ? 180 : 0 }} transition={{ duration: 0.15 }} className="ml-auto">
              <IconChevronDown className="size-3.5" stroke={1.6} />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {showWarnings && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                {warnings.map((w) => (
                  <li key={w} className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {w}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

/** Hero: is today's position built on fresh data? One card per export. */
export function TodayHealth({ today }: { today: DashboardFeed['today'] }) {
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">Today's data</h2>
        <span className="text-xs text-muted-foreground/70">{formatDay(today.positionDate)}</span>
      </div>
      <motion.div variants={stagger} initial="hidden" animate="visible" className="mt-2 flex flex-col gap-2 sm:flex-row">
        {KIND_ORDER.map((kind) => (
          <SlotCard key={kind} kind={kind} slot={today.slots[kind]} />
        ))}
      </motion.div>
    </section>
  );
}
