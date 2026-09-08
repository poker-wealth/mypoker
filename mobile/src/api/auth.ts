import { api } from '../api';

/**
 * Sign-in.
 *
 * These are the same three gateway endpoints the Mini App uses
 * (`game-server/src/gateway/auth.ts`), and every one of them returns the same shape: a JWT and the
 * player it belongs to. The app never decides who you are — it asks, stores the answer, and sends
 * it back on later calls.
 *
 * The token is written to SecureStore by the caller (see `src/session.ts`). It authorises money, so
 * it does not go anywhere else.
 */

/**
 * The signed-in player, exactly as the gateway sends it.
 *
 * Mirrors `PlayerProfile` in `game-server/src/gateway/auth.ts`. This used to be
 * an `AuthPlayer` of four optional-ish fields that agreed with the wire on
 * neither name nor count — `avatarUrl` for what the gateway calls `photoUrl`,
 * and no `username`, `telegramId` or `vipTier` at all. Nothing caught it
 * because nothing imported this module: `auth.tsx` called `api.post` directly
 * with a second, correct copy of the type. One definition now, in the API layer
 * where the wire shape belongs.
 */
export interface Player {
  playerId: string;
  displayName: string;
  username: string | null;
  photoUrl: string | null;
  telegramId: number | null;
  vipTier: number;
}

export interface AuthResult {
  token: string;
  player: Player;
}

export function loginWithEmail(email: string, passwordPlain: string): Promise<AuthResult> {
  return api.post<AuthResult>('/auth/login', { email, password: passwordPlain });
}

/**
 * A sign-up waiting on its emailed code.
 *
 * NOT an `AuthResult`. `/auth/signup` no longer returns a token: the account
 * exists but nobody has proved they own the address. The types are deliberately
 * unrelated, because the old code did `setToken(res.token)` on the signup
 * response and would now store `undefined` — signing the app into a session
 * that does not exist and 401ing on every call after it.
 */
export interface PendingConfirmation {
  pending: true;
  /** Normalised by the server; confirm against THIS, not what was typed. */
  email: string;
  /** ISO 8601. When the code stops working. */
  expiresAt: string;
  /** ISO 8601. When a resend becomes available. */
  resendAvailableAt: string;
}

/** Start an email sign-up. Creates the account and mails a code; mints nothing. */
export function signupWithEmail(
  email: string,
  passwordPlain: string,
  displayName?: string,
): Promise<PendingConfirmation> {
  return api.post<PendingConfirmation>('/auth/signup', {
    email,
    password: passwordPlain,
    // Omit entirely when empty rather than sending "" — the gateway treats an
    // absent field differently from a blank one.
    ...(displayName ? { displayName } : {}),
  });
}

/** Exchange the emailed code for a session. This is what finishes a sign-up. */
export function confirmEmailCode(email: string, code: string): Promise<AuthResult> {
  return api.post<AuthResult>('/auth/verify-otp', { email, code });
}

/** Another code for a confirmation already in flight. */
export function resendEmailCode(email: string): Promise<PendingConfirmation> {
  return api.post<PendingConfirmation>('/auth/resend-otp', { email });
}

/**
 * Exchange a Google token for ours.
 *
 * The gateway accepts either an `idToken` (a JWT it verifies offline against GOOGLE_CLIENT_ID) or
 * an implicit-flow `token` it resolves through Google's userinfo endpoint. The Mini App sends the
 * implicit-flow access token and so does this — the field is named `token` for exactly that path.
 */
export function loginWithGoogle(accessToken: string): Promise<AuthResult> {
  return api.post<AuthResult>('/auth/google', { token: accessToken });
}
