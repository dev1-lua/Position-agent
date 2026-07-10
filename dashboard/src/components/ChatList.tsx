import { useState, type FormEvent } from 'react';
import { IconPlus, IconMessage, IconPencil, IconTrash, IconCheck } from '@tabler/icons-react';

import { cn } from '@/lib/cn';
import type { ChatMeta } from '@/lib/chats';

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

interface ChatListProps {
  chats: ChatMeta[];
  activeChatId: string;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
}

/** The conversations panel inside the Position Agent section. */
export function ChatList({ chats, activeChatId, onNewChat, onSelectChat, onRenameChat, onDeleteChat }: ChatListProps) {
  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-background">
      <div className="p-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex h-8 w-full items-center justify-center gap-2 rounded-sm bg-primary text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
        >
          <IconPlus className="size-4 shrink-0" />
          New chat
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 pt-0">
        <div className="px-2.5 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
          Chats
        </div>
        {chats.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            active={chat.id === activeChatId}
            onSelect={() => onSelectChat(chat.id)}
            onRename={(title) => onRenameChat(chat.id, title)}
            onDelete={() => onDeleteChat(chat.id)}
          />
        ))}
        {chats.length === 0 && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">No chats yet.</p>}
      </nav>
    </div>
  );
}
