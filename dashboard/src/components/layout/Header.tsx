import { useLocation } from 'react-router-dom';

import { NAV_ITEMS } from './Sidebar';

function activeNavItem(pathname: string) {
  return NAV_ITEMS.find((item) => pathname.startsWith(item.path)) ?? NAV_ITEMS[0];
}

/**
 * The panel's breadcrumb bar (Twenty: icon-in-muted-square + 13px medium
 * title on the left, quiet metadata on the right).
 */
export function Header() {
  const active = activeNavItem(useLocation().pathname);
  const ActiveIcon = active.icon;

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-border px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
          <ActiveIcon className="size-3.5" stroke={1.6} />
        </span>
        <h1 className="truncate text-sm font-medium">{active.label}</h1>
      </div>
      <p className="hidden truncate text-xs text-muted-foreground/70 sm:block">{active.tagline}</p>
    </header>
  );
}
