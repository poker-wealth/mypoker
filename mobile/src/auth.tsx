import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
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
    // Deliberately NOT verified against the server: a stored token is treated
    // as signed-in on the strength of its presence alone. An expired token
    // surfaces as a 401 from whichever screen asks first — api.ts already
    // clears it when that happens. A startup `/auth/me` check that confirms
    // the token is still good before rendering anything is the upgrade path,
    // not a requirement of this pass.
    void (async () => {
      const token = await getToken();
      if (cancelled) return;
      if (token === null) {
        setStatus('signedOut');
        return;
      }
      // Restore WHO we last signed in as, not just that we did. Without this the shell is
      // 'signedIn' with a null player, and the account screen greeted a signed-in person as
      // "Guest Player" with no id. /auth/me is not the answer on its own — it returns
      // `displayName: playerId`, a placeholder rather than their actual name.
      const cached = await getCachedPlayer<Player>();
      if (cancelled) return;
      if (cached) setPlayer(cached);
      setStatus('signedIn');
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
      void setCachedPlayer(res.player);
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
