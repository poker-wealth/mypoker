import { ApiError } from './client';

/**
 * Turns a thrown request error into copy a player can act on.
 *
 * The raw messages are diagnostics — "Expected JSON from /me/stats but got
 * text/html" tells an engineer exactly what happened and tells a player
 * nothing except that something is broken in a way that sounds like their
 * fault. Those belong in the console; the UI gets a translated sentence and a
 * retry button.
 *
 * Returns a translation key, so callers own the t() call.
 */
export function errorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'states.error';

  // status 0 — the request never reached a server at all.
  if (error.status === 0) return 'states.offline';
  if (error.status === 401 || error.status === 403) return 'states.sessionExpired';

  // A 2xx that wasn't JSON means the route isn't wired up on this deployment —
  // the SPA fallback answered instead. Not the player's problem, and not
  // something a retry fixes, but "unavailable" is the honest description.
  if (error.status >= 500 || (error.status >= 200 && error.status < 300)) {
    return 'states.serviceUnavailable';
  }

  return 'states.error';
}

/**
 * Log the technical detail where an engineer will find it.
 *
 * Called alongside errorKey so the diagnostic isn't simply discarded when the
 * UI shows the friendly version.
 */
export function logError(context: string, error: unknown): void {
  const detail = error instanceof ApiError ? `[${error.status}] ${error.message}` : error;
  console.error(`[${context}]`, detail);
}
