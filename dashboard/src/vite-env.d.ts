/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Lua agent id the chat widget attaches to (optional; has a baked-in default). */
  readonly VITE_LUA_AGENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
