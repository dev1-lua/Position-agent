import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { IconMessageChatbot, IconChevronLeft, type Icon } from '@tabler/icons-react';

import { cn } from '@/lib/cn';

const COLLAPSE_KEY = 'position-assistant-sidebar-collapsed';

/**
 * Workspace sections. Position Agent is the only one today; future sections
 * (reports, uploads, …) are one entry + one route each — same shape as the
 * Sucafina dashboard's NAV_ITEMS.
 */
export const NAV_ITEMS = [
  { label: 'Position Agent', path: '/position', icon: IconMessageChatbot, iconClass: 'text-indigo-500' },
] as const satisfies ReadonlyArray<{ label: string; path: string; icon: Icon; iconClass: string }>;

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Small square brand mark (same pattern as the Sucafina dashboard sidebar). */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-sm bg-primary text-xs font-semibold leading-none text-primary-foreground',
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

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 ease-out',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <div className={cn('flex h-12 shrink-0 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        <BrandMark />
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold tracking-tight">Sucafina</div>
            <div className="truncate text-2xs text-muted-foreground">Kenya trading desk</div>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {!collapsed && (
          <div className="px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            Workspace
          </div>
        )}
        {NAV_ITEMS.map(({ label, path, icon: Icon, iconClass }) => (
          <NavLink
            key={path}
            to={path}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground',
                collapsed && 'justify-center px-0',
                isActive && 'bg-muted text-foreground',
              )
            }
          >
            <Icon className={cn('size-4 shrink-0', iconClass)} />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn(
          'flex h-9 shrink-0 items-center gap-2 border-t border-border px-2.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        <IconChevronLeft className={cn('size-4 shrink-0 transition-transform duration-200', collapsed && 'rotate-180')} />
        {!collapsed && <span className="text-xs">Collapse</span>}
      </button>
    </aside>
  );
}
