/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the game-server gateway, e.g. http://localhost:4100. */
  readonly VITE_API_URL?: string;
  /**
   * Dev-only escape hatch: sign in with a fake player when the app is opened
   * outside Telegram (no initData). Never set this in a deployed build.
   */
  readonly VITE_DEV_AUTH_BYPASS?: string;
  /** Base URL of the live-table server, e.g. http://localhost:4200. Defaults to VITE_API_URL. */
  readonly VITE_TABLES_URL?: string;
  /** Override only if the game socket isn't at `${VITE_TABLES_URL}/ws`. */
  readonly VITE_TABLES_WS_URL?: string;
  /** Bot username (without @) — used only to derive the default Support chat link. */
  readonly VITE_TELEGRAM_BOT_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
