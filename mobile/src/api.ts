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
    /**
     * The parsed error body, when the server sent one.
     *
     * The message alone is player-facing copy, and branching on it means
     * branching on a sentence somebody will reword. The gateway puts a stable
     * machine field next to it — `code: 'email_unverified'`, and the address
     * and resend timing that go with it — and that is only reachable if the
     * body survives the throw. It did not, so it does now.
     */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** One field off the error body, or undefined. Never throws. */
  detail<T = unknown>(field: string): T | undefined {
    if (!this.body || typeof this.body !== 'object') return undefined;
    return (this.body as Record<string, unknown>)[field] as T | undefined;
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
    throw new ApiError(401, message, body);
  }

  if (!res.ok) {
    // Prefer the server's own message: it is the one that knows WHY, and the
    // money paths return refusals a user can act on ("48h cooldown", "not a
    // member") that a generic string would throw away.
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

/**
 * Forgot-password, both steps — unauthenticated, same contract the Mini App
 * uses (gateway: /auth/forgot-password, /auth/reset-password). Step 1 answers
 * identically whether or not the email exists (anti-enumeration — never
 * "helpfully" distinguish); step 2 takes the mailed code and the new password.
 */
export const forgotPasswordApi = (email: string): Promise<{ resendAvailableAt?: string | null }> =>
  api.post('/auth/forgot-password', { email });

/**
 * Step 1.5: is the code right, before we ask for a password?
 *
 * Deliberately does NOT spend the code — the gateway's `check` leaves the
 * challenge intact so `resetPasswordApi` below can still use it. Without that
 * separation, checking the code would consume it and the reset would then fail
 * with "no reset pending", which is worse than not checking at all.
 */
export const checkResetCodeApi = (email: string, code: string): Promise<{ ok: true }> =>
  api.post('/auth/check-reset-code', { email, code });

export const resetPasswordApi = (
  email: string,
  code: string,
  newPassword: string,
): Promise<unknown> => api.post('/auth/reset-password', { email, code, newPassword });

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
  // Added for Settings: the gateway only accepts PATCH on /me/settings
  // (game-server/src/gateway/me-routes.ts), and nothing here needed it before.
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
};
