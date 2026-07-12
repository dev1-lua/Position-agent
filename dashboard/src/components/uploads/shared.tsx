import { motion } from 'framer-motion';

import { cn } from '@/lib/cn';
import type { SlotKind } from '@/lib/useFeed';

/** Display order + desk names for the three exports. */
export const KIND_ORDER: readonly SlotKind[] = ['stock', 'dnp', 'sales'] as const;

export const KIND_LABEL: Record<SlotKind, string> = {
  stock: 'XBS Stock',
  dnp: 'SOL Net Position',
  sales: 'SOL Sales',
};

export const KIND_FILE: Record<SlotKind, string> = {
  stock: 'XBS Current Stock export',
  dnp: 'SOL DailyNetPosition export',
  sales: 'SOL ReportLogistic export',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-07-13' → 'Jul 13, 2026' (position dates are plain calendar days). */
export function formatDay(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return d;
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

/** ISO timestamp → 'Jul 13, 09:14' in desk time (Nairobi). */
export function formatTime(iso: string): string {
  try {
    return new Date(iso)
      .toLocaleString('en-GB', {
        timeZone: 'Africa/Nairobi',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      .replace(',', ',');
  } catch {
    return iso;
  }
}

const DOT_COLOR = {
  fresh: 'bg-emerald-500',
  stale: 'bg-amber-500',
  missing: 'bg-red-400',
} as const;

/** Status dot; the missing state pulses gently to pull the eye. */
export function StatusDot({ status, className }: { status: keyof typeof DOT_COLOR; className?: string }) {
  return (
    <span className={cn('relative flex size-2 shrink-0', className)}>
      {status === 'missing' && (
        <motion.span
          className={cn('absolute inline-flex h-full w-full rounded-full', DOT_COLOR[status])}
          animate={{ scale: [1, 1.9], opacity: [0.5, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <span className={cn('relative inline-flex size-2 rounded-full', DOT_COLOR[status])} />
    </span>
  );
}

/** Twenty-quiet entrance: small rise, short duration, no springiness. */
export const rise = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
};

export const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};
