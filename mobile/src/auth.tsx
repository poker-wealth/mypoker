import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import {
  confirmEmailCode,
  resendEmailCode,
  signupWithEmail,
  type AuthResult,
  type PendingConfirmation,
  type Player,
} from './api/auth';
import { signInWithGoogleNative } from './googleAuth';
import {
  clearCachedPlayer,
  clearToken,
  getCachedPlayer,
  getToken,
  onSessionLost,
  setCachedPlayer,
  setToken,
} from './session';

/**
 * Session state, owned by React context — there is no state library in this
 * app (no zustand/redux), and a login/logout event is rare enough that a
 * context provider re-rendering its subtree is not a performance concern.
 */

// Re-exported so existing importers of `Player` from this module keep working;
// the definition itself lives with the API client that receives it.
export type { Player };

type Status = 'loading' | 'signedIn' | 'signedOut';

/** The wire shape of every endpoint that mints a session. */
type AuthResponse = AuthResult;

interface AuthContextValue {
  status: Status;
  player: Player | null;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Start an email sign-up.
   *
   * Returns a PENDING CONFIRMATION, not a session. Nothing is stored and nobody
   * is signed in until `confirmEmail` succeeds — the return type is what makes
   * that impossible to miss at the call site, and it is why this is not
   * `Promise<void>` like its neighbours.
   */
  signUp: (email: string, password: string, displayName?: string) => Promise<PendingConfirmation>;
  /** Finish a sign-up: exchange the emailed code for a session. */
  confirmEmail: (email: string, code: string) => Promise<void>;
  /** Another code for a confirmation already in flight. */
  resendCode: (email: string) => Promise<PendingConfirmation>;
  signInWithGoogle: () => Promise<void>;
  /**
   * Re-read `/auth/me` and replace the cached player.
   *
   * For changes made from inside the app that the server is authority on — the
   * display name is the first. Without it the header and every screen reading
   * the cached player keep showing the old name until the next cold start,
   * which reads as the save having silently failed.
   */
  refreshPlayer: () => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
  clearError: () => void;
  busy: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [player, setPlayer] = useState<Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // This fixes "shows Guest Player on cold start" from both directions we
    // independently chased it (the cache from Esther, the server check from
    // me), and keeping both here is deliberate — not leftover merge noise.
    // We paint from the cache first because it's instant and it's the only
    // source that works with no network at all, but a cache can go stale (a
    // changed display name or VIP tier never shows up) and it says nothing
    // about whether the token is even still valid — only the server can
    // answer that — so we still ask it right after, and correct the
    // in-memory player if the answer differs from the cache.
    void (async () => {
      const token = await getToken();
      if (cancelled) return;
      if (token === null) {
        setStatus('signedOut');
        return;
      }
      const cached = await getCachedPlayer<Player>();
      if (cancelled) return;
      if (cached) setPlayer(cached);
      setStatus('signedIn');
      try {
        const profile = await api.get<Player>('/auth/me');
        if (cancelled) return;
        setPlayer(profile);
        void setCachedPlayer(profile);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          // api.ts has already cleared the token and fired onSessionLost;
          // the effect below is subscribed to that and will sign out and
          // clear the query cache. Touching state here too would race it.
          return;
        }
        // Any other failure (offline, timeout, 5xx) means we simply
        // couldn't reach the server, not that the session is bad. We stay
        // signed in with whatever the cache gave us — a lift with no signal
        // or a flaky tunnel is not a reason to sign someone out or wipe a
        // perfectly good cached profile over a slightly stale name.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // This is what turns a 401 anywhere in the app into a return to the login
    // screen: api.ts clears the token on any 401, but that alone does not
    // touch this context's state. Subscribing here means the moment the token
    // is dropped — from this screen, a background refetch, anywhere — the
    // shell drops out of the signed-in view instead of continuing to render
    // it over a session the server has already forgotten.
    return onSessionLost(() => {
      // The cached profile goes with the session. Leaving it behind would greet the NEXT person
      // to open the app on this device by the previous player's name.
      void clearCachedPlayer();
      setPlayer(null);
      setStatus('signedOut');
      queryClient.clear();
    });
  }, [queryClient]);

  const clearError = useCallback(() => setError(null), []);

  const signIn = useCallback(async (email: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<AuthResponse>('/auth/login', { email, password });
      await setToken(res.token);
      setPlayer(res.player);
      void setCachedPlayer(res.player);
      setStatus('signedIn');
    } catch (err) {
      // ApiError.message is the server's own words (see api.ts) — kept as-is
      // rather than swapped for a generic string. The `Error` fallback below
      // only matters for a throw api.ts never actually produces.
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Store a session and switch the app into it.
   *
   * Shared by every path that ends in a token — password sign-in, Google, and
   * now the confirmation step. Previously each one repeated these four lines,
   * which is how the sign-up path came to do them against a response that no
   * longer carries a token.
   */
  const adoptSession = useCallback(async (res: AuthResponse) => {
    await setToken(res.token);
    setPlayer(res.player);
    void setCachedPlayer(res.player);
    setStatus('signedIn');
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string): Promise<PendingConfirmation> => {
      setBusy(true);
      setError(null);
      try {
        // No setToken, no setStatus. The account now exists and is unconfirmed;
        // the caller's next stop is the code screen.
        return await signupWithEmail(email, password, displayName);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const confirmEmail = useCallback(
    async (email: string, code: string) => {
      setBusy(true);
      setError(null);
      try {
        await adoptSession(await confirmEmailCode(email, code));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [adoptSession],
  );

  const resendCode = useCallback(async (email: string): Promise<PendingConfirmation> => {
    setError(null);
    try {
      return await resendEmailCode(email);
    } catch (err) {
      // A 429 message already says how long to wait, in the server's own words.
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  const refreshPlayer = useCallback(async () => {
    try {
      const profile = await api.get<Player>('/auth/me');
      setPlayer(profile);
      void setCachedPlayer(profile);
    } catch {
      // Best-effort. A failed refresh leaves the previous player in place,
      // which is stale but true-as-of-last-read; blanking it would be worse.
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const idToken = await signInWithGoogleNative();
      if (idToken === null) {
        // User cancelled the native sheet — not an error, nothing to show.
        return;
      }
      const res = await api.post<AuthResponse>('/auth/google', { idToken });
      await setToken(res.token);
      setPlayer(res.player);
      void setCachedPlayer(res.player);
      setStatus('signedIn');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    await clearCachedPlayer();
    setPlayer(null);
    setStatus('signedOut');
    // Wipe every cached query, not just invalidate: react-query would
    // otherwise keep the previous player's data on screen (e.g. wallet
    // balance) until a refetch lands, and the next person to sign in on this
    // device would see it in the interim.
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      player,
      signIn,
      signUp,
      confirmEmail,
      resendCode,
      signInWithGoogle,
      refreshPlayer,
      signOut,
      error,
      clearError,
      busy,
    }),
    [
      status,
      player,
      signIn,
      signUp,
      confirmEmail,
      resendCode,
      signInWithGoogle,
      refreshPlayer,
      signOut,
      error,
      clearError,
      busy,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
