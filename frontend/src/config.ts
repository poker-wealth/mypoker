/**
 * Runtime configuration, resolved once at module load.
 *
 * The app talks to **game-server** and nothing else — game-server is the gateway
 * that authenticates players, runs the games, and calls financial-core internally
 * whenever money moves (see docs/handoff/02-architecture.md). The frontend never
 * addresses financial-core directly, so there is deliberately only one base URL.
 */

/**
 * Where the API lives — the game-server gateway. There are no Netlify Functions;
 * the deployed static site reaches the gateway cross-origin, so VITE_API_URL MUST
 * be set to the gateway's URL in the deploy environment (the gateway sets CORS).
 * Local dev points this at the Express gateway (port 4100) via .env.local. Unset
 * falls back to same-origin, which only works when something local proxies the API.
 */
export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/**
 * Allow signing in outside Telegram, for local work in a plain browser. Gated on
 * DEV so a production bundle can never enable it, whatever the env says.
 */
export const DEV_AUTH_BYPASS =
  import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';

/**
 * Where the live tables live.
 *
 * The table server runs beside the gateway today (`npm run tables`, port 4200) and speaks the
 * gateway's player token, so this is a second base URL only until the two share a port — at which
 * point `VITE_TABLES_URL` drops away and this falls back to `API_URL`.
 */
export const TABLES_URL = (import.meta.env.VITE_TABLES_URL ?? API_URL ?? '').replace(/\/$/, '');

/** The game socket, derived from the table server's origin. */
export const TABLES_WS_URL =
  import.meta.env.VITE_TABLES_WS_URL ??
  `${(TABLES_URL || window.location.origin).replace(/^http/, 'ws')}/ws`;

/** Bot username (no @) — used only to derive the default Support chat link. */
export const TELEGRAM_BOT_NAME = import.meta.env.VITE_TELEGRAM_BOT_NAME ?? '';

/**
 * Where "Support" links to — a Telegram chat, help desk, or mailto. Falls back
 * to the bot's chat when only the bot is configured; empty means the Settings
 * row shows a "connecting" toast instead of navigating nowhere.
 */
export const SUPPORT_URL =
  import.meta.env.VITE_SUPPORT_URL ?? (TELEGRAM_BOT_NAME ? `https://t.me/${TELEGRAM_BOT_NAME}` : '');

/** The table opened when a game id isn't itself a table id (see the table server's room list). */
export const DEFAULT_TABLE_ID = 'texas';
export const LIVE_TABLE_IDS = new Set(['texas', 'texas-high']);
