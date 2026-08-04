/**
 * Runtime configuration, resolved once at module load.
 *
 * The app talks to **game-server** and nothing else — game-server is the gateway
 * that authenticates players, runs the games, and calls financial-core internally
 * whenever money moves (see docs/handoff/02-architecture.md). The frontend never
 * addresses financial-core directly, so there is deliberately only one base URL.
 */

/**
 * Where the API lives.
 *
 * Unset means same-origin, which is what the deployed site wants: `/auth/*` is
 * served by a Netlify Function alongside the app, so there's no cross-origin hop
 * and no CORS involved. Local dev sets this to the Express gateway (port 4100)
 * via .env.local.
 */
export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/**
 * Allow signing in outside Telegram, for local work in a plain browser. Gated on
 * DEV so a production bundle can never enable it, whatever the env says.
 */
export const DEV_AUTH_BYPASS =
  import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
