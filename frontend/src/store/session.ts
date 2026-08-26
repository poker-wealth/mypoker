import { create } from 'zustand';
import i18n from 'i18next';
import { setAuthToken, setUnauthorizedHandler, ApiError } from '@/api/client';
import {
  loginWithTelegram,
  loginAsDevPlayer,
  loginWithGoogle,
  loginWithEmail,
  signupWithEmail,
  confirmEmailCode,
  resendEmailCode,
  type LoginResponse,
  type PendingConfirmation,
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
  /**
   * Start an email sign-up.
   *
   * Returns a PENDING CONFIRMATION, not a session — nothing is stored and
   * nobody is signed in until `confirmEmail` succeeds. The return type is what
   * makes that impossible to miss at the call site.
   */
  signUpWithEmail: (
    email: string,
    passwordPlain: string,
    displayName?: string,
  ) => Promise<PendingConfirmation>;
  /** Finish a sign-up: exchange the emailed code for a session. */
  confirmEmail: (email: string, code: string) => Promise<void>;
  /** Ask for another code for a confirmation already in flight. */
  resendCode: (email: string) => Promise<PendingConfirmation>;
  signOut: () => void;
}

/**
 * The email address a failed sign-in says still needs confirming, or null.
 *
 * The gateway answers 403 with `code: 'email_unverified'` when the PASSWORD WAS
 * CORRECT but the address was never confirmed. Matched on that field rather
 * than on the message text: the message is player-facing copy and will be
 * reworded, and a rewording must not quietly turn "confirm your email" back
 * into "wrong password".
 */
export function unconfirmedEmailFrom(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  const body = error.body as { code?: string; email?: string } | undefined;
  return body?.code === 'email_unverified' ? (body.email ?? null) : null;
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
    // Deliberately NOT `settle`. There is no token to store and nobody to greet
    // — the account exists but is unconfirmed. Routing this through the
    // sign-in path would toast "Signed in as ..." over a screen asking for a
    // code, and would have to invent a session out of a response that has none.
    set({ status: 'authenticating', error: null });
    try {
      const pending = await signupWithEmail(email, passwordPlain, displayName);
      set({ status: 'anonymous', error: null });
      return pending;
    } catch (e) {
      const message = e instanceof ApiError ? e.message : i18n.t('toasts.signUpFailed');
      set({ status: 'error', error: message });
      toast.error(message);
      throw e;
    }
  },

  confirmEmail: async (email, code) => {
    await settle(() => confirmEmailCode(email, code));
  },

  resendCode: async (email) => {
    try {
      const pending = await resendEmailCode(email);
      toast.success(i18n.t('toasts.codeResent'));
      return pending;
    } catch (e) {
      // Rate limiting arrives here as a 429 whose message already says how long
      // to wait, in the server's own words. Kept rather than replaced.
      const message = e instanceof ApiError ? e.message : i18n.t('toasts.codeResendFailed');
      toast.error(message);
      throw e;
    }
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
