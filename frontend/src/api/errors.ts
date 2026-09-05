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
 * The same job, for the ADMIN panel, where the rule is inverted.
 *
 * `errorKey` deliberately discards a server message, because on a player screen
 * the raw text is a diagnostic and the reader is not an engineer. In the admin
 * API the opposite is true: a 4xx there carries a sentence written FOR an
 * administrator and naming the exact thing they did — "you cannot suspend your
 * own account", "that address belongs to another account", "Password must be at
 * least 8 characters". Replacing those with "Something went wrong" strips the
 * only part that says what to do next, which is what happened to a real
 * self-suspend attempt: the guard worked perfectly and the screen made it look
 * like a fault.
 *
 * Only 4xx. A 500 message is a stack-shaped diagnostic and an admin can act on
 * it no better than a player; those still get the translated line, and the
 * caller passes `fallback` for them.
 */
export function adminErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403) {
    return error.message || fallback;
  }
  return fallback;
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

/**
 * The create-league-table answer, as a sentence the player can act on.
 *
 * `errorKey` is for QUERY screens and collapses 403 into "your session expired",
 * which is exactly wrong here: a 403 from this endpoint means the session is
 * fine and the player simply is not an admin of that league. Every documented
 * outcome of POST /leagues/:leagueId/tables gets its own key:
 *
 *   400 no settings  the league has not chosen a rake/buy-in yet — actionable
 *   400 other        blinds or seats the endpoint refuses
 *   403              a member, but not an owner or admin
 *   404              not a member (the server answers 404, not 403, so a
 *                    stranger cannot probe which leagues exist)
 *   503              league tables deliberately closed (server kill switch)
 *   502/5xx          the league service did not answer
 *
 * The 400 split reads the server's message because status alone cannot tell the
 * two apart. It is a fallback, not the contract: an unrecognised 400 still lands
 * on the generic "those settings are not valid".
 */
export function leagueTableErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'states.error';

  if (error.status === 0) return 'states.offline';
  if (error.status === 401) return 'states.sessionExpired';
  if (error.status === 403) return 'alliance.tableNotAdmin';
  if (error.status === 404) return 'alliance.tableNotMember';
  if (error.status === 503) return 'alliance.tableClosed';
  if (error.status >= 500) return 'states.serviceUnavailable';
  if (error.status === 400) {
    return /rake and buy-in/i.test(error.message) ? 'alliance.tableNoSettings' : 'alliance.tableInvalid';
  }
  return 'states.error';
}
