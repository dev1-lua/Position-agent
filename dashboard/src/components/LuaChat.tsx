import { useMemo } from 'react';

// LuaPop UMD bundle (CDN). There is no reliable npm package.
const LUA_POP_SRC = 'https://lua-ai-global.github.io/lua-pop/lua-pop.umd.js';

// The Position Assistant agent. Overridable per-environment; the fallback keeps
// the widget working if the var is unset.
const AGENT_ID = import.meta.env.VITE_LUA_AGENT_ID ?? 'baseAgent_agent_1783605834540_m15tfg10k';

/** Events the iframe relays up to the app (see buildSrcDoc). */
export interface LuaChatEvent {
  eventType: 'message_sent' | 'message_received';
  /** Present only on message_received — LuaPop's message_sent carries no content. */
  content?: string;
}

export const LUA_CHAT_EVENT_SOURCE = 'position-assistant-chat';

/**
 * Why an iframe, not a direct mount (learned in Sucafina/dashboard-v2):
 *
 * The LuaPop bundle is ~22 MB AND it installs *global* side effects — it
 * replaces `history.pushState`/`replaceState`, opens WebSockets, and starts
 * dozens of intervals. Inside an iframe all of that is sandboxed into a
 * separate JS context; unmounting the iframe reclaims every socket, interval
 * and listener. Remounting with a different `sessionId` is also the ONLY
 * reliable way to switch conversations — the widget reads the id once at init
 * (its `setupSessionId` prefers `config.sessionId` over localStorage).
 */
function buildSrcDoc(sessionId: string): string {
  const cfgJson = JSON.stringify({
    agentId: AGENT_ID,
    // Bypasses the widget's domain whitelist (so it runs on localhost + previews)
    // and points at the live agent — chat here talks to PRODUCTION data.
    environment: 'production',
    // Pin light: the widget defaults to `theme: 'auto'` (follows the OS), which
    // would render a black chat inside our light-pinned app on dark machines.
    theme: 'light',
    displayMode: 'embedded',
    embeddedDisplayConfig: {
      targetContainerId: 'lua-chat-embedded-root',
      useContainerHeight: true,
      conversationStarters: [
        "What's my net position?",
        'How much of my stock is blocked?',
        'Stock by warehouse — and how old is it?',
        'How much of the book re-rates if NY moves?',
      ],
    },
    chatTitle: 'Position Assistant',
    chatInputPlaceholder: 'Ask about longs, shorts, net, prices, stock…',
    welcomeMessage:
      'Morning. I can compute the desk position from the XBS/SOL exports, or answer against the last snapshot — which day are we looking at?',
    attachmentsEnabled: true,
    // This chat's Lua session id — the widget resumes this thread's history.
    sessionId,
  });
  const originJson = JSON.stringify(window.location.origin);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light" />
<style>
  html, body { height: 100%; margin: 0; }
  body { background: transparent; }
  #lua-chat-embedded-root { height: 100%; width: 100%; }
</style>
</head>
<body>
<div id="lua-chat-embedded-root"></div>
<script>
  // Event relay: LuaPop posts full events ({type:'LUA_POP_EVENT', eventType,
  // data}) only to ITS OWN window — the copy it sends to window.parent is
  // stripped of data. So we listen here, in the widget's context, and forward
  // what the app needs (activity for ordering, assistant text for titling).
  (function () {
    var ORIGIN = ${originJson};
    var SOURCE = ${JSON.stringify(LUA_CHAT_EVENT_SOURCE)};
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.type !== 'LUA_POP_EVENT') return;
      if (d.eventType !== 'message_sent' && d.eventType !== 'message_received') return;
      try {
        window.parent.postMessage(
          {
            source: SOURCE,
            eventType: d.eventType,
            content: d.data && typeof d.data.content === 'string' ? d.data.content : undefined,
          },
          ORIGIN,
        );
      } catch (_) {}
    });
  })();
  window.__LUA_BOOT = function () {
    try { window.LuaPop && window.LuaPop.init(${cfgJson}); }
    catch (e) { console.error('LuaPop init failed', e); }
  };
  // Load the bundle via fetch so we can PATCH its attachment handling before
  // it runs (verified against the UMD source, 2026-07-10):
  //  1. The file input's accept list is hardcoded WITHOUT spreadsheet types,
  //     so .csv/.xls/.xlsx are greyed out in the OS file picker — the desk's
  //     XBS/SOL exports can't even be selected.
  //  2. matchesAccept() then re-validates by comparing file.type (a MIME
  //     type) against each accept pattern with ===, so extension patterns
  //     like ".pdf" NEVER match — every non-media file is rejected with
  //     "No files match the accepted types" even after passing the picker.
  // Both patches are exact-string; if the bundle changes upstream they no-op
  // harmlessly and we're back to stock behavior (warned in the console).
  (function () {
    var SRC = ${JSON.stringify(LUA_POP_SRC)};
    function loadRaw() {
      var s = document.createElement('script');
      s.src = SRC;
      s.onload = window.__LUA_BOOT;
      document.body.appendChild(s);
    }
    fetch(SRC)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (code) {
        var ACCEPT = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.txt';
        var VALIDATE = 'return f2.type === pattern;';
        if (code.indexOf(ACCEPT) === -1 || code.indexOf(VALIDATE) === -1) {
          console.warn('LuaPop bundle changed upstream - attachment patches skipped');
        }
        var patched = code
          .split(ACCEPT).join(ACCEPT + ',.csv,.xls,.xlsx')
          .split(VALIDATE).join(
            'return f2.type === pattern || (pattern.charAt(0) === "." && f2.name.toLowerCase().endsWith(pattern.toLowerCase()));'
          );
        var s = document.createElement('script');
        s.src = URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }));
        s.onload = window.__LUA_BOOT;
        document.body.appendChild(s);
      })
      .catch(function (e) {
        console.warn('LuaPop fetch-patch failed, loading stock bundle', e);
        loadRaw();
      });
  })();
</script>
</body>
</html>`;
}

/**
 * Inline (embedded) LuaPop chat for one conversation, isolated in an iframe.
 * Key it by `sessionId` so switching chats swaps the whole widget context.
 */
export function LuaChat({ sessionId }: { sessionId: string }) {
  const srcDoc = useMemo(() => buildSrcDoc(sessionId), [sessionId]);

  return (
    <iframe
      title="Position Assistant chat"
      srcDoc={srcDoc}
      className="h-full w-full border-0"
      // The widget offers file attachments (XBS/SOL uploads) + voice; grant those.
      allow="microphone; clipboard-write"
    />
  );
}

export default LuaChat;
