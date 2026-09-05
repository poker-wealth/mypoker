import { API_URL } from '@/config';

/**
 * The one way the app reaches the backend: a thin fetch wrapper over the
 * game-server gateway that attaches the base URL, JSON headers, and the player
 * token, and turns non-2xx responses into a typed error.
 *
 * The token lives in a module-level slot rather than being imported from the
 * session store — the store calls `setAuthToken`, so there's no import cycle
 * between the store (which logs in via this client) and the client itself.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onReachabilityChange: ((reachable: boolean) => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Registered by the session store so a 401 anywhere drops the stale session. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

/**
 * Registered by the connection store. Called with `false` when a request cannot
 * reach the server at all, and `true` as soon as one gets through — which is a
 * better signal than navigator.onLine, since that only reports whether the
 * device has an interface, not whether anything is answering on it.
 */
export function setReachabilityHandler(handler: (reachable: boolean) => void): void {
  onReachabilityChange = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header — used by the login call itself. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (!anonymous && authToken) headers.authorization = `Bearer ${authToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // fetch only rejects on network/CORS failure — the server was never reached.
    onReachabilityChange?.(false);
    throw new ApiError(0, `Cannot reach the server at ${API_URL}`, cause);
  }

  // We got a response, so the server is reachable — even a 500 proves that, and
  // the banner should come down. Only transport failures mean "no connection".
  onReachabilityChange?.(true);

  return toResult<T>(res, path, anonymous);
}

interface UploadOptions {
  /** The real content type of the bytes — best-effort; the server never trusts it (see avatar-processing.ts). */
  contentType: string;
  signal?: AbortSignal;
}

/**
 * Raw-bytes POST — distinct from `request` because the body IS the payload
 * and must reach the server byte-for-byte, not be `JSON.stringify`'d. Used by
 * avatar upload, whose gateway route reads the exact posted bytes and sniffs
 * their real format itself; wrapping them in JSON here would just hand the
 * server a string to un-wrap for no benefit.
 */
async function requestUpload<T>(path: string, body: Blob, options: UploadOptions): Promise<T> {
  const { contentType, signal } = options;
  const headers: Record<string, string> = { 'content-type': contentType };
  if (authToken) headers.authorization = `Bearer ${authToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers,
      body,
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    onReachabilityChange?.(false);
    throw new ApiError(0, `Cannot reach the server at ${API_URL}`, cause);
  }

  onReachabilityChange?.(true);
  return toResult<T>(res, path);
}

/**
 * Shared response handling for both `request` and `requestUpload`.
 *
 * `anonymous` has to be passed in rather than read from an outer scope: this
 * function was extracted so uploads could share it, and the 401 rule below
 * depends on whether the call carried a token. Defaulting to `false` keeps the
 * authenticated behaviour — drop the session on a 401 — for `requestUpload`,
 * which is never anonymous.
 */
async function toResult<T>(res: Response, path: string, anonymous = false): Promise<T> {
  let parsed = false;
  const payload: unknown = await res
    .json()
    .then((body: unknown) => {
      parsed = true;
      return body;
    })
    .catch(() => null);

  if (!res.ok) {
    // A 401 on an AUTHENTICATED call means the token died — drop the session.
    // A 401 on an anonymous call (login/signup) means "wrong credentials"; that
    // is the caller's to surface inline, and signing out here would replace the
    // real "incorrect password" with a confusing "Signed out" toast.
    if (res.status === 401 && !anonymous) onUnauthorized?.();
    const message =
      (payload as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, payload);
  }

  if (!parsed) {
    throw new ApiError(res.status, `Expected JSON from ${path} but got ${res.headers.get('content-type') ?? 'no content-type'}`);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  /** Raw-bytes POST — see `requestUpload`. */
  upload: <T>(path: string, body: Blob, options: UploadOptions) => requestUpload<T>(path, body, options),
};
