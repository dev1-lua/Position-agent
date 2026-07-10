import { IconChartHistogram } from '@tabler/icons-react';

/**
 * Dashboard section — placeholder until the analytics views land.
 * Twenty-style empty state: muted icon square, quiet copy, no accent fills.
 */
export default function DashboardPage() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="flex size-10 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
          <IconChartHistogram className="size-5" stroke={1.6} />
        </span>
        <h2 className="mt-4 text-sm font-medium">Dashboard</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Position trends over time, net-by-grade charts and the morning digest — all built on the
          same ingested XBS/SOL data.
        </p>
        <span className="mt-4 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-btn">
          Coming soon
        </span>
      </div>
    </div>
  );
}
