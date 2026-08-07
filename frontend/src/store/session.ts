import { create } from 'zustand';
import i18n from 'i18next';
import { setAuthToken, setUnauthorizedHandler, ApiError } from '@/api/client';
import {
  loginWithTelegram,
  loginWithTelegramWidget,
  loginAsDevPlayer,
  loginWithEmail,
  signupWithEmail,
  loginWithGoogle,
  type LoginResponse,
  type Player,
  type TelegramWidgetUser,
} from '@/api/auth';
import { initData } from '@/lib/telegram';
import { DEV_AUTH_BYPASS } from '@/config';
import { toast } from '@/store/toast';

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
  /** Sign in from the Login Widget's onauth payload (plain browser, no Mini App). */
  signInWithWidget: (user: TelegramWidgetUser) => Promise<void>;
  /** Mock sign in for UI prototyping. */
  mockSignIn: () => void;
  signInWithEmail: (email: string, passwordPlain: string) => Promise<void>;
  signUpWithEmail: (email: string, passwordPlain: string, displayName?: string) => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => void;
}

const storedToken = localStorage.getItem(TOKEN_KEY);
setAuthToken(storedToken);

export const useSession = create<SessionState>((set, get) => {
  // Shared tail of every login flavour (Mini App, Login Widget, dev): run the
  // exchange, store what came back, tell the player. Only how the credential is
  // obtained differs between the entry points.
  const settle = async (login: () => Promise<LoginResponse>): Promise<void> => {
    set({ status: 'authenticating', error: null });
    try {
      const { token, player } = await login();
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
        // The Login Widget (signInWithWidget) is the way in from here.
        set({ status: 'anonymous', error: null });
        return;
      }

      await settle(() => (payload ? loginWithTelegram(payload) : loginAsDevPlayer()));
    },

    signInWithWidget: async (user) => {
      if (get().status === 'authenticating') return;
      await settle(() => loginWithTelegramWidget(user));
    },

    signInWithEmail: async (email, passwordPlain) => {
      if (get().status === 'authenticating') return;
      await settle(() => loginWithEmail(email, passwordPlain));
    },

    signUpWithEmail: async (email, passwordPlain, displayName) => {
      if (get().status === 'authenticating') return;
      await settle(() => signupWithEmail(email, passwordPlain, displayName));
    },

    signInWithGoogle: async (idToken) => {
      if (get().status === 'authenticating') return;
      await settle(() => loginWithGoogle(idToken));
    },

    mockSignIn: () => {
      const player: Player = {
        playerId: 'mock-1',
        displayName: 'Mock Player',
        username: 'mockplayer',
        photoUrl: null,
        telegramId: null,
        vipTier: 0,
      };
      const token = 'mock_token';
      setAuthToken(token);
      persist(token, player);
      set({ token, player, status: 'authenticated', error: null });
      toast.success('Signed in with Mock Credentials');
    },

    signOut: () => {
      const wasSignedIn = get().token !== null;
      setAuthToken(null);
      persist(null, null);
      // 'anonymous', never 'idle' — even inside Telegram. 'idle' means "we haven't
      // tried yet", which is the state AppShell auto-signs-in from, so using it here
      // would have the app log straight back in and make Sign out a no-op. Signing
      // back in stays possible, but only by tapping the button.
      set({ token: null, player: null, status: 'anonymous', error: null });
      if (wasSignedIn) {
        toast.info(i18n.t('toasts.signedOut'));
      }
    },
  };
});

// A 401 from any call means the token is dead — drop it rather than letting the
// UI keep claiming the player is signed in.
setUnauthorizedHandler(() => useSession.getState().signOut());
