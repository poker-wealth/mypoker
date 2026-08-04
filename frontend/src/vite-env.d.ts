/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the game-server gateway, e.g. http://localhost:4100. */
  readonly VITE_API_URL?: string;
  /**
   * Dev-only escape hatch: sign in with a fake player when the app is opened
   * outside Telegram (no initData). Never set this in a deployed build.
   */
  readonly VITE_DEV_AUTH_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
