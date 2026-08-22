import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { signInWithGoogleNative } from './googleAuth';
import { clearToken, getToken, onSessionLost, setToken } from './session';

/**
 * Session state, owned by React context — there is no state library in this
 * app (no zustand/redux), and a login/logout event is rare enough that a
 * context provider re-rendering its subtree is not a performance concern.
 */

export interface Player {
  playerId: string;
  displayName: string;
  username: string | null;
  photoUrl: string | null;
  telegramId: number | null;
  vipTier: number;
}

type Status = 'loading' | 'signedIn' | 'signedOut';

interface AuthResponse {
  token: string;
  player: Player;
}

interface AuthContextValue {
  status: Status;
  player: Player | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
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
    // A stored token alone is not proof of a valid session, so on cold start
    // we ask the server who it belongs to instead of trusting its mere
    // presence. Three outcomes, each handled differently:
    //   - No token: nothing to restore, straight to signed-out.
    //   - The server confirms it (200): restore the real profile so the UI
    //     never shows a placeholder name for a genuinely signed-in person.
    //   - The server rejects it (401): do nothing here. api.ts already
    //     cleared the token and fired onSessionLost, and the effect below is
    //     subscribed to that — it will set signed-out and clear the query
    //     cache. Setting state here too would race it.
    //   - Anything else (offline, timeout, 5xx — i.e. we simply couldn't
    //     reach the server): stay signed in with `player` left null. We know
    //     a token exists; we just couldn't confirm the name that goes with
    //     it. Treating an unreachable server as a sign-out would destroy a
    //     valid session over a network blip, which is worse than a missing
    //     display name. Individual screens fetch their own data and surface
    //     their own errors.
    void (async () => {
      const token = await getToken();
      if (cancelled) return;
      if (token === null) {
        setStatus('signedOut');
        return;
      }
      try {
        const profile = await api.get<Player>('/auth/me');
        if (cancelled) return;
        setPlayer(profile);
        setStatus('signedIn');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          return;
        }
        setStatus('signedIn');
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

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<AuthResponse>('/auth/signup', {
        email,
        password,
        // Omit entirely when empty rather than sending "" — the gateway
        // treats an absent field differently from a blank one.
        ...(displayName ? { displayName } : {}),
      });
      await setToken(res.token);
      setPlayer(res.player);
      setStatus('signedIn');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setBusy(false);
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
    setPlayer(null);
    setStatus('signedOut');
    // Wipe every cached query, not just invalidate: react-query would
    // otherwise keep the previous player's data on screen (e.g. wallet
    // balance) until a refetch lands, and the next person to sign in on this
    // device would see it in the interim.
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, player, signIn, signUp, signInWithGoogle, signOut, error, clearError, busy }),
    [status, player, signIn, signUp, signInWithGoogle, signOut, error, clearError, busy],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
