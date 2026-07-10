import { useState, type FormEvent } from 'react';
import {
  IconPlus,
  IconMessage,
  IconPencil,
  IconTrash,
  IconChevronLeft,
  IconCheck,
} from '@tabler/icons-react';

import { cn } from '@/lib/cn';
import type { ChatMeta } from '@/lib/chats';

const COLLAPSE_KEY = 'position-assistant-sidebar-collapsed';

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

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface SidebarProps {
  chats: ChatMeta[];
  activeChatId: string;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
}

function ChatRow({
  chat,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  chat: ChatMeta;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title);

  function submit(e: FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (title) onRename(title);
    setEditing(false);
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="flex items-center gap-1 rounded-sm bg-muted px-1.5 py-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          className="h-6 w-full min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-sm outline-none focus:border-ring"
          aria-label="Chat title"
        />
        <button type="submit" className="rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label="Save title">
          <IconCheck className="size-3.5" />
        </button>
      </form>
    );
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground',
        active && 'bg-muted text-foreground',
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={chat.title}>
        <IconMessage className="size-4 shrink-0 text-muted-foreground/70" />
        <span className="truncate">{chat.title}</span>
      </button>
      <span className="shrink-0 text-2xs text-muted-foreground/70 group-hover:hidden">{dayLabel(chat.lastUsedAt)}</span>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <button
          type="button"
          onClick={() => {
            setDraft(chat.title);
            setEditing(true);
          }}
          className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          aria-label={`Rename chat "${chat.title}"`}
        >
          <IconPencil className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-sm p-0.5 text-muted-foreground hover:text-destructive"
          aria-label={`Delete chat "${chat.title}"`}
        >
          <IconTrash className="size-3.5" />
        </button>
      </span>
    </div>
  );
}

export function Sidebar({ chats, activeChatId, onNewChat, onSelectChat, onRenameChat, onDeleteChat }: SidebarProps) {
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
        collapsed ? 'w-14' : 'w-64',
      )}
    >
      <div className={cn('flex h-12 shrink-0 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        <BrandMark />
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold tracking-tight">Position Assistant</div>
            <div className="truncate text-2xs text-muted-foreground">Sucafina · Kenya desk</div>
          </div>
        )}
      </div>

      <div className={cn('px-2 pb-2', collapsed && 'px-1.5')}>
        <button
          type="button"
          onClick={onNewChat}
          title="New chat"
          className={cn(
            'flex h-8 w-full items-center justify-center gap-2 rounded-sm bg-primary text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90',
          )}
        >
          <IconPlus className="size-4 shrink-0" />
          {!collapsed && 'New chat'}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 pt-0">
        {!collapsed && (
          <div className="px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            Chats
          </div>
        )}
        {!collapsed &&
          chats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={chat.id === activeChatId}
              onSelect={() => onSelectChat(chat.id)}
              onRename={(title) => onRenameChat(chat.id, title)}
              onDelete={() => onDeleteChat(chat.id)}
            />
          ))}
        {!collapsed && chats.length === 0 && (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">No chats yet.</p>
        )}
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
