import { create } from 'zustand';
import i18n from 'i18next';
import { setAuthToken, setUnauthorizedHandler, ApiError } from '@/api/client';
import {
  loginWithTelegram,
  loginAsDevPlayer,
  loginWithGoogle,
  loginWithEmail,
  signupWithEmail,
  type LoginResponse,
  type Player,
} from '@/api/auth';
import { initData } from '@/lib/telegram';
import { DEV_AUTH_BYPASS } from '@/config';
import { toast } from '@/lib/toast';

/**
 * Who's signed in. The token is persisted so a reload inside Telegram doesn't
 * bounce the player back to a signed-out screen; the player object rides along
 * so the profile header can paint immediately rather than flashing empty.
 *
 * Everything here is a cache of what the server said — the token is the only
 * thing that actually grants access, and the server re-verifies it every call.
 */

export type SessionStatus = 'idle' | 'authenticating' | 'authenticated' | 'anonymous' | 'error';

const TOKEN_KEY = 'fp-token';
const PLAYER_KEY = 'fp-player';

function readStoredPlayer(): Player | null {
  try {
    const raw = localStorage.getItem(PLAYER_KEY);
    return raw ? (JSON.parse(raw) as Player) : null;
  } catch {
    return null;
  }
}

function persist(token: string | null, player: Player | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);

  if (player) localStorage.setItem(PLAYER_KEY, JSON.stringify(player));
  else localStorage.removeItem(PLAYER_KEY);
}

interface SessionState {
  token: string | null;
  player: Player | null;
  status: SessionStatus;
  error: string | null;
  /** Sign in from the Telegram launch payload. Safe to call more than once. */
  signIn: () => Promise<void>;
  /** Browser sign-in: exchange a Google OAuth access token for a session. */
  signInWithGoogle: (accessToken: string) => Promise<void>;
  signInWithEmail: (email: string, passwordPlain: string) => Promise<void>;
  signUpWithEmail: (email: string, passwordPlain: string, displayName?: string) => Promise<void>;
  /**
   * Admin-host sign-in. Like `signInWithEmail`, but ONLY establishes a session
   * for an `ops` account — a player who tries the admin login is refused and no
   * player session is left behind. The credential check itself is server-side;
   * this just declines to store a non-admin result.
   */
  signInAsAdmin: (email: string, passwordPlain: string) => Promise<void>;
  /** Admin-host Google sign-in — same ops-only rule as `signInAsAdmin`. */
  signInWithGoogleAsAdmin: (accessToken: string) => Promise<void>;
  signOut: () => void;
}

const storedToken = localStorage.getItem(TOKEN_KEY);
setAuthToken(storedToken);

export const useSession = create<SessionState>((set, get) => {
  // Shared tail of every browser login flavour: run the exchange, store what
  // came back, tell the player. Only how the credential is obtained differs.
  const settle = async (login: () => Promise<LoginResponse>): Promise<void> => {
    if (get().status === 'authenticating') return;
    set({ status: 'authenticating', error: null });
    try {
      const { token, player } = await login();
      setAuthToken(token);
      persist(token, player);
      set({ token, player, status: 'authenticated', error: null });
      toast.success(i18n.t('toasts.signedIn', { name: player.displayName }));
    } catch (e) {
      const message = e instanceof ApiError ? e.message : i18n.t('toasts.signInFailed');
      set({ status: 'error', error: message });
      toast.error(message);
      throw e;
    }
  };

  // Same as `settle`, but ONLY establishes a session for an `ops` account — a
  // valid player credential is refused with no token stored, so the admin host
  // never holds a player session. Shared by the email and Google admin flows.
  const settleAdmin = async (login: () => Promise<LoginResponse>): Promise<void> => {
    if (get().status === 'authenticating') return;
    set({ status: 'authenticating', error: null });
    try {
      const { token, player } = await login();
      if (player.role !== 'ops') {
        set({ status: get().token ? 'authenticated' : 'anonymous', error: null });
        throw new ApiError(403, 'This account is not an administrator.');
      }
      setAuthToken(token);
      persist(token, player);
      set({ token, player, status: 'authenticated', error: null });
      toast.success(i18n.t('toasts.signedIn', { name: player.displayName }));
    } catch (e) {
      const message = e instanceof ApiError ? e.message : i18n.t('toasts.signInFailed');
      set({ status: get().token ? 'authenticated' : 'anonymous', error: message });
      throw e;
    }
  };

  return {
  token: storedToken,
  player: storedToken ? readStoredPlayer() : null,
  status: storedToken ? 'authenticated' : 'idle',
  error: null,

  signIn: async () => {
    if (get().status === 'authenticating') return;

    const payload = initData();
    if (!payload && !DEV_AUTH_BYPASS) {
      // Opened outside Telegram: not an error, just nobody to sign in as.
      set({ status: 'anonymous', error: null });
      return;
    }

    set({ status: 'authenticating', error: null });
    try {
      const { token, player } = payload
        ? await loginWithTelegram(payload)
        : await loginAsDevPlayer();
      setAuthToken(token);
      persist(token, player);
      set({ token, player, status: 'authenticated', error: null });
      // i18n.t(), not the hook — this runs outside React, and a raw key would
      // surface on screen as literal `toasts.signedIn`.
      toast.success(i18n.t('toasts.signedIn', { name: player.displayName }));
    } catch (e) {
      const message = e instanceof ApiError ? e.message : i18n.t('toasts.signInFailed');
      set({ status: 'error', error: message });
      toast.error(message);
    }
  },

  signInWithGoogle: async (accessToken) => {
    await settle(() => loginWithGoogle(accessToken));
  },

  signInWithEmail: async (email, passwordPlain) => {
    await settle(() => loginWithEmail(email, passwordPlain));
  },

  signUpWithEmail: async (email, passwordPlain, displayName) => {
    await settle(() => signupWithEmail(email, passwordPlain, displayName));
  },

  signInAsAdmin: async (email, passwordPlain) => {
    await settleAdmin(() => loginWithEmail(email, passwordPlain));
  },

  signInWithGoogleAsAdmin: async (accessToken) => {
    await settleAdmin(() => loginWithGoogle(accessToken));
  },

  signOut: () => {
    setAuthToken(null);
    persist(null, null);
    // 'anonymous', never 'idle' — even inside Telegram. 'idle' means "we haven't
    // tried yet", which is the state AppShell auto-signs-in from, so using it here
    // would have the app log straight back in and make Sign out a no-op. Signing
    // back in stays possible, but only by tapping the button.
    set({ token: null, player: null, status: 'anonymous', error: null });
    toast.info(i18n.t('toasts.signedOut'));
  },
  };
});

// A 401 from any call means the token is dead — drop it rather than letting the
// UI keep claiming the player is signed in.
setUnauthorizedHandler(() => useSession.getState().signOut());
