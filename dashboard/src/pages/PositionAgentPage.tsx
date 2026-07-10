import { useEffect, useRef, useState } from 'react';

import { ChatList } from '@/components/ChatList';
import { LuaChat, LUA_CHAT_EVENT_SOURCE } from '@/components/LuaChat';
import {
  loadChats,
  createChat,
  updateChat,
  deleteChat,
  getActiveChatId,
  setActiveChatId,
  titleFromText,
  type ChatMeta,
} from '@/lib/chats';

function initialState(): { chats: ChatMeta[]; activeId: string } {
  let chats = loadChats();
  if (chats.length === 0) {
    createChat();
    chats = loadChats();
  }
  const stored = getActiveChatId();
  const activeId = chats.some((c) => c.id === stored) ? (stored as string) : chats[0].id;
  return { chats, activeId };
}

/**
 * The Position Agent section: conversations panel + the embedded Lua chat.
 * All chat state (list, active id, auto-titling) is owned here — other
 * sections don't carry it.
 */
export default function PositionAgentPage() {
  const [{ chats, activeId }, setState] = useState(initialState);
  // The relay fires message_received for every reply; only the first one in a
  // still-untitled chat should set the title. Ref (not state): no re-render needed.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  function refresh(nextActiveId?: string) {
    setState((prev) => ({ chats: loadChats(), activeId: nextActiveId ?? prev.activeId }));
  }

  function handleNewChat() {
    const chat = createChat();
    refresh(chat.id);
  }

  function handleSelectChat(id: string) {
    setActiveChatId(id);
    refresh(id);
  }

  function handleRenameChat(id: string, title: string) {
    updateChat(id, { title, titled: true });
    refresh();
  }

  function handleDeleteChat(id: string) {
    // Forgets the LIST entry only — the conversation itself lives server-side
    // under its Lua session id and is not erased by this.
    const remaining = deleteChat(id);
    if (id !== activeIdRef.current) {
      refresh();
      return;
    }
    const next = remaining[0] ?? createChat();
    setActiveChatId(next.id);
    refresh(next.id);
  }

  // Chat activity events relayed from the widget iframe: bump ordering on every
  // message, and auto-title an untitled chat from the first assistant reply
  // (LuaPop's message_sent event carries no text, so the user side can't title).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { source?: string; eventType?: string; content?: string } | null;
      if (!data || data.source !== LUA_CHAT_EVENT_SOURCE) return;

      const id = activeIdRef.current;
      const chat = loadChats().find((c) => c.id === id);
      if (!chat) return;

      const patch: Partial<ChatMeta> = { lastUsedAt: Date.now() };
      if (data.eventType === 'message_received' && !chat.titled && data.content) {
        patch.title = titleFromText(data.content);
        patch.titled = true;
      }
      updateChat(id, patch);
      refresh();
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <ChatList
        chats={chats}
        activeChatId={activeId}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onRenameChat={handleRenameChat}
        onDeleteChat={handleDeleteChat}
      />

      {/* The app frame's white panel IS the card — the chat fills it directly.
          Key by chat id: switching chats swaps the whole iframe/widget context
          so the widget re-inits with that chat's session id. */}
      <div className="min-w-0 flex-1 bg-card">
        <LuaChat key={activeId} sessionId={activeId} />
      </div>
    </div>
  );
}
