/**
 * Local chat registry — the "preserved older chats" the embedded LuaPop widget
 * doesn't give us. Conversation CONTENT lives server-side under a Lua session
 * id (the widget's `setupSessionId` honors a `sessionId` passed in its init
 * config, resuming that thread); we only persist the id + a label per chat in
 * localStorage. No backend: clearing browser storage forgets the LIST, not the
 * conversations themselves.
 */

export interface ChatMeta {
  /** Lua session id — minted by us, handed to the widget via init config. */
  id: string;
  title: string;
  createdAt: number;
  lastUsedAt: number;
  /** True once a title was derived from the conversation or typed by the user. */
  titled: boolean;
}

const CHATS_KEY = 'position-assistant-chats';
const ACTIVE_KEY = 'position-assistant-active-chat';

function read(): ChatMeta[] {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    const parsed = raw ? (JSON.parse(raw) as ChatMeta[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(chats: ChatMeta[]): void {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch {
    /* private mode / storage full — the session still works, just unlisted */
  }
}

/** Newest activity first. */
export function loadChats(): ChatMeta[] {
  return read().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export function createChat(): ChatMeta {
  const now = Date.now();
  const chat: ChatMeta = {
    id: crypto.randomUUID(),
    title: 'New chat',
    createdAt: now,
    lastUsedAt: now,
    titled: false,
  };
  write([chat, ...read()]);
  setActiveChatId(chat.id);
  return chat;
}

export function updateChat(id: string, patch: Partial<Omit<ChatMeta, 'id'>>): ChatMeta[] {
  write(read().map((c) => (c.id === id ? { ...c, ...patch } : c)));
  return loadChats();
}

export function deleteChat(id: string): ChatMeta[] {
  write(read().filter((c) => c.id !== id));
  return loadChats();
}

export function getActiveChatId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveChatId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Derive a list label from conversation text: strip markdown chrome, one line, ~48 chars. */
export function titleFromText(text: string): string {
  const cleaned = text
    .replace(/[#*_`>|-]+/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'New chat';
  return cleaned.length > 48 ? `${cleaned.slice(0, 47).trimEnd()}…` : cleaned;
}
