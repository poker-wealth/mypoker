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

export interface AuthPlayer {
  playerId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
}

export interface AuthResult {
  token: string;
  player: AuthPlayer;
}

export function loginWithEmail(email: string, passwordPlain: string): Promise<AuthResult> {
  return api.post<AuthResult>('/auth/login', { email, password: passwordPlain });
}

export function signupWithEmail(
  email: string,
  passwordPlain: string,
  displayName: string,
): Promise<AuthResult> {
  return api.post<AuthResult>('/auth/signup', { email, password: passwordPlain, displayName });
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
