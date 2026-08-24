import { getApiBase } from './apiConfig';
import { clearToken, getToken } from './session';

/**
 * The one API client. The shell owns it; the game side uses it.
 *
 * Deliberately small and dependency-free — it mirrors the Mini App's client
 * (`frontend/src/api/client.ts`) in behaviour so the two cannot answer the same
 * question differently, but it does not import it: that file is bundled for a
 * browser and reaches for browser globals.
 */

// Re-exported so App.tsx and TableScreen.tsx (which display the configured
// gateway) keep one definition of the build-time URL rather than importing
// from apiConfig.ts directly. This is the build-time value only — it does NOT
// reflect a runtime override; see apiConfig.ts's `getApiBase`.
export { BUILD_API_URL as API_URL } from './apiConfig';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A request that never resolves is worse than one that fails — phones change networks. */
const TIMEOUT_MS = 15_000;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = await getApiBase();
  if (!base) {
    throw new ApiError(0, 'No API URL configured — set EXPO_PUBLIC_API_URL for this build.');
  }

  const token = await getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    // Offline, DNS, a dropped connection, or our own timeout. Status 0 means
    // "never reached the server", which callers render differently from a
    // refusal — the server saying no is not the same as not asking.
    throw new ApiError(0, (err as Error)?.name === 'AbortError' ? 'The request timed out.' : 'Could not reach the server.');
  } finally {
    clearTimeout(timer);
  }

  const body: unknown = await res.json().catch(() => null);

  if (res.status === 401) {
    // A 401 means two different things depending on whether this request carried a token. With a
    // token, the server is telling us a session it once accepted no longer exists — drop it so the
    // app stops presenting a signed-in shell over a session the server has already forgotten. With
    // NO token, there was never a session to expire — this is a login (or other unauthenticated
    // call) being refused, and the server's own message is the reason (a wrong password, say), not
    // a session ending mid-login. Clearing the token and firing session-lost here would wipe the
    // cached player and the query cache for someone who was never signed in.
    if (token) {
      await clearToken();
      throw new ApiError(401, 'Your session has expired. Sign in again.');
    }
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'Sign in failed.';
    throw new ApiError(401, message);
  }

  if (!res.ok) {
    // Prefer the server's own message: it is the one that knows WHY, and the
    // money paths return refusals a user can act on ("48h cooldown", "not a
    // member") that a generic string would throw away.
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
  // Added for Settings: the gateway only accepts PATCH on /me/settings
  // (game-server/src/gateway/me-routes.ts), and nothing here needed it before.
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
};
