import { motion } from 'framer-motion';
import { IconCheck, IconChartDots } from '@tabler/icons-react';

import { cn } from '@/lib/cn';
import type { FeedDateRow, SlotKind } from '@/lib/useFeed';
import { KIND_LABEL, KIND_ORDER, formatDay, formatTime, rise, stagger } from './shared';

/** listSnapshotSummaries keys DNP as `dailyNetPosition`; events use `dnp`. */
const HAS_KEY: Record<SlotKind, string> = { stock: 'stock', dnp: 'dailyNetPosition', sales: 'sales' };

function KindCell({ row, kind }: { row: FeedDateRow; kind: SlotKind }) {
  const present = !!row.has[HAS_KEY[kind]];
  const count = row.eventCounts[kind] ?? 0;
  if (!present && count === 0) return <span className="text-muted-foreground/40">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {present ? (
        <IconCheck className="size-3.5 text-emerald-600" stroke={2} />
      ) : (
        <span className="text-muted-foreground/40">—</span>
      )}
      {count > 1 && (
        <span
          className="rounded-sm border border-border bg-muted px-1 py-px text-2xs font-medium text-muted-foreground"
          title={`${count} uploads recorded for this day`}
        >
          ×{count}
        </span>
      )}
    </span>
  );
}

/**
 * One row per position date, newest first: the three inputs, whether the
 * computed results exist, and the re-upload badge. Deleted dates (audit
 * events exist, snapshot removed) render struck-through.
 */
export function HistoryGrid({ dates }: { dates: FeedDateRow[] }) {
  if (dates.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-medium">History</h2>
        <p className="mt-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
          Nothing uploaded yet — history starts with the first ingested export.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-medium">History</h2>
      <div className="mt-2 overflow-x-auto rounded-md border border-border shadow-btn">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Position date</th>
              {KIND_ORDER.map((k) => (
                <th key={k} className="px-3 py-2 font-medium">
                  {KIND_LABEL[k]}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Computed</th>
              {/* snapshot updatedAt = last WRITE (ingest, recompute or manual pot) — not upload time */}
              <th className="px-3 py-2 font-medium">Last modified</th>
            </tr>
          </thead>
          <motion.tbody variants={stagger} initial="hidden" animate="visible">
            {dates.map((row) => {
              const computed = !!(row.has.theoretical || row.has.forwardSales || row.has.netPosition || row.has.futsSpread);
              return (
                <motion.tr
                  key={row.positionDate}
                  variants={rise}
                  className={cn(
                    'border-b border-border last:border-b-0 hover:bg-black/[0.02]',
                    row.deleted && 'text-muted-foreground/50 line-through',
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {formatDay(row.positionDate)}
                    {row.deleted && (
                      <span className="ml-2 rounded-sm border border-border bg-muted px-1 py-px text-2xs font-medium no-underline">
                        deleted
                      </span>
                    )}
                  </td>
                  {KIND_ORDER.map((k) => (
                    <td key={k} className="px-3 py-2">
                      <KindCell row={row} kind={k} />
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {computed ? (
                      <IconChartDots className="size-3.5 text-muted-foreground" stroke={1.8} />
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {row.updatedAt ? formatTime(row.updatedAt) : '—'}
                  </td>
                </motion.tr>
              );
            })}
          </motion.tbody>
        </table>
      </div>
    </section>
  );
}
