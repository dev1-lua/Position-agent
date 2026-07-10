import { useLocation } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { NAV_ITEMS } from './Sidebar';

function activeNavItem(pathname: string) {
  return NAV_ITEMS.find((item) => pathname.startsWith(item.path)) ?? NAV_ITEMS[0];
}

export function Header() {
  const active = activeNavItem(useLocation().pathname);
  const ActiveIcon = active.icon;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted', active.iconClass)}>
          <ActiveIcon className="size-3.5" />
        </span>
        <h1 className="truncate text-sm font-semibold">{active.label}</h1>
      </div>
      <p className="hidden truncate text-xs text-muted-foreground sm:block">
        Longs − shorts = net · answers come from the ingested XBS/SOL exports · production data
      </p>
    </header>
  );
}
