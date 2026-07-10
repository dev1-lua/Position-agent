# Position Assistant — desk frontend

Password-gated web UI for the Sucafina Kenya desk's Position Assistant Lua
agent. Multi-conversation chat (new chat + preserved history) over the
embedded LuaPop widget — no backend of our own.

Design language mirrors `Sucafina/dashboard-v2` (the sample-management
dashboard): 13px Inter, true-neutral grays, one indigo accent, hairline
borders, light-pinned UI.

## How chats persist without a backend

- Each sidebar chat is a **Lua session id** (UUID we mint). The LuaPop widget
  accepts `sessionId` in its init config and resumes that thread's history
  from Lua's servers.
- The chat **list** (id + title + timestamps) lives in `localStorage`
  (`position-assistant-chats`). Clearing browser storage forgets the list,
  not the conversations.
- Titles: first assistant reply auto-titles a chat (LuaPop's `message_sent`
  event carries no text, so the user side can't); rename inline via the
  pencil icon. Deleting a chat only removes it from the list.
- The widget runs inside an `srcdoc` iframe (pattern from dashboard-v2): the
  ~22 MB bundle patches `history`, opens sockets and starts intervals — the
  iframe sandboxes all of it, and remounting with a new `sessionId` is the
  reliable way to switch conversations.

## Local dev

```bash
npm install
npm run dev        # http://localhost:5175 — no password gate locally
```

The password gate is Vercel Edge Middleware (`middleware.ts`); `vite dev`
does not run it, so local dev is ungated. Chat always talks to the
PRODUCTION agent (`environment: 'production'` also bypasses LuaPop's domain
whitelist on localhost).

## Deploy (Vercel)

1. Create a Vercel project with **Root Directory = `dashboard/`**
   (framework: Vite; build/output are read from `vercel.json`).
2. Set env vars in the Vercel project settings:
   - `SITE_PASSWORD` — the access password (server-side only; without it the
     gate is OFF and the site serves openly).
   - `VITE_LUA_AGENT_ID` — optional; defaults to the Position Assistant
     agent id baked into `src/components/LuaChat.tsx`.
3. Deploy (`vercel` / git integration). The login cookie lasts 7 days.
4. Optional: whitelist the deployed domain in the Lua admin dashboard
   (Chat Widget → Customization) — inline config bypasses it, but the
   whitelist is the belt-and-braces once the URL is stable.
