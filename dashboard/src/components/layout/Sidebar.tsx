import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  IconMessageChatbot,
  IconChartHistogram,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  type Icon,
} from '@tabler/icons-react';

import { cn } from '@/lib/cn';

const COLLAPSE_KEY = 'position-assistant-sidebar-collapsed';

/**
 * Workspace sections. Position Agent is the only one today; future sections
 * (reports, uploads, …) are one entry + one route each.
 *
 * Twenty language: the sidebar is TRANSPARENT on the canvas (no border, no
 * fill), nav icons are neutral gray at 16px, labels 13px, section headings
 * 11px sentence-case, hover/active are gray alpha washes.
 */
export const NAV_ITEMS = [
  {
    label: 'Position Agent',
    path: '/position',
    icon: IconMessageChatbot,
    tagline: 'Longs − shorts = net · answers come from the ingested XBS/SOL exports · production data',
  },
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: IconChartHistogram,
    tagline: 'Position trends, charts and the morning digest',
  },
] as const satisfies ReadonlyArray<{ label: string; path: string; icon: Icon; tagline: string }>;

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Small square brand mark — the one place the accent color is allowed to sit. */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-sm bg-primary text-xs font-semibold leading-none text-primary-foreground shadow-btn',
        className,
      )}
      aria-hidden="true"
    >
      S
    </span>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const ToggleIcon = collapsed ? IconLayoutSidebarLeftExpand : IconLayoutSidebarLeftCollapse;

  return (
    <aside
      className={cn(
        'group/sidebar flex h-full shrink-0 flex-col transition-[width] duration-200 ease-out',
        collapsed ? 'w-11' : 'w-56',
      )}
    >
      <div className={cn('flex h-9 shrink-0 items-center gap-2 px-1.5', collapsed && 'flex-col justify-center gap-1 px-0 pt-1 h-auto')}>
        <BrandMark />
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">Sucafina</div>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 opacity-0 transition-opacity duration-150 hover:bg-black/[0.06] hover:text-foreground group-hover/sidebar:opacity-100',
            collapsed && 'opacity-100',
          )}
        >
          <ToggleIcon className="size-4" stroke={1.6} />
        </button>
      </div>

      <nav className={cn('flex flex-1 flex-col gap-px overflow-y-auto px-1.5 pt-4', collapsed && 'items-center px-0')}>
        {!collapsed && (
          <div className="px-2 pb-1 text-xs font-medium text-muted-foreground/60">Workspace</div>
        )}
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'flex h-7 items-center gap-2 rounded-sm px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-black/[0.04] hover:text-foreground',
                collapsed && 'w-7 justify-center gap-0 px-0',
                isActive && 'bg-black/[0.06] font-medium text-foreground',
              )
            }
          >
            <Icon className="size-4 shrink-0" stroke={1.6} />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {!collapsed && (
        <div className="shrink-0 px-3.5 pb-1.5 text-2xs text-muted-foreground/50">Kenya trading desk</div>
      )}
    </aside>
  );
}
