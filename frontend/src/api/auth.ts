import { api } from './client';

/** The player identity the gateway returns at login. */
export interface Player {
  playerId: string;
  displayName: string;
  username: string | null;
  photoUrl: string | null;
  telegramId: number | null;
  vipTier: number;
}

export interface LoginResponse {
  token: string;
  player: Player;
}

/**
 * Exchange a signed Telegram `initData` payload for a player session.
 * The gateway verifies the HMAC — the client never inspects or trusts it.
 */
export function loginWithTelegram(initData: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/telegram', { initData }, { anonymous: true });
}

/**
 * The payload Telegram's Login Widget hands to its onauth callback. Signed with
 * a different scheme than initData; the gateway verifies it at /auth/telegram-widget.
 */
export interface TelegramWidgetUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/** Exchange a Login Widget payload (browser sign-in, outside the Mini App) for a session. */
export function loginWithTelegramWidget(user: TelegramWidgetUser): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/telegram-widget', user, { anonymous: true });
}

/** Dev-only sign-in for working in a plain browser. Rejected unless the server runs with it enabled. */
export function loginAsDevPlayer(): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/dev', {}, { anonymous: true });
}

/**
 * The extra facts `/auth/me` alone reports about the CALLER's own account —
 * mirrors `SelfProfile` in gateway/auth.ts, including its comment on why these
 * stay off the shared `Player` shape: every other endpoint (login, Telegram,
 * Google, display-name change) answers with a `Player` that other players can
 * also be described by, and `email`/`hasPassword` are not safe to hand back
 * about anyone but yourself. Extending `Player` here — instead of adding the
 * fields to it — keeps that boundary on the client the same as on the server.
 *
 * `email` is `null` for an account with no email on file (a Telegram sign-in,
 * which has no stored document at all, or a legacy phone sign-up) — never a
 * fabricated address.
 */
export interface SelfProfile extends Player {
  email: string | null;
  hasPassword: boolean;
}

/** Re-read the signed-in player (e.g. after a reload, to confirm the token is still good). */
export function fetchMe(): Promise<SelfProfile> {
  return api.get<SelfProfile>('/auth/me');
}

/**
 * A sign-up waiting on its emailed code.
 *
 * NOT a `LoginResponse`. `/auth/signup` no longer returns a token: the account
 * exists but nobody has proved they own the address, so there is no session to
 * hand out until `confirmEmailCode` succeeds. The types are deliberately
 * unrelated so a caller cannot reach for `.token` and get `undefined` at
 * runtime — which is exactly what the mobile client did before it was updated.
 */
export interface PendingConfirmation {
  pending: true;
  /** Normalised by the server; use THIS for the confirm call, not what was typed. */
  email: string;
  /** ISO 8601. When the code stops working. */
  expiresAt: string;
  /** ISO 8601. When "resend" becomes available. */
  resendAvailableAt: string;
}

/**
 * Start an email sign-up. Creates the account and mails a code; mints nothing.
 *
 * Resolves to a pending confirmation, or throws — a 400 for an address already
 * confirmed, a 503 when the code could not be sent at all.
 */
export function signupWithEmail(
  email: string,
  passwordPlain: string,
  displayName?: string,
): Promise<PendingConfirmation> {
  return api.post<PendingConfirmation>(
    '/auth/signup',
    { email, password: passwordPlain, displayName },
    { anonymous: true },
  );
}

/** Exchange the emailed code for a session. This is what finishes a sign-up. */
export function confirmEmailCode(email: string, code: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/verify-otp', { email, code }, { anonymous: true });
}

/**
 * Ask for another code.
 *
 * Only works while a confirmation is already in flight — the server will not
 * mint one for an address with nothing pending, so this cannot be used to send
 * mail to a stranger.
 */
export function resendEmailCode(email: string): Promise<PendingConfirmation> {
  return api.post<PendingConfirmation>('/auth/resend-otp', { email }, { anonymous: true });
}

export function loginWithEmail(email: string, passwordPlain: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/login', { email, password: passwordPlain }, { anonymous: true });
}

export function loginWithGoogle(token: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/google', { credential: token, idToken: token }, { anonymous: true });
}

// ── Profile & password self-service ──────────────────────────────────────────
// Mirrors the three routes' own doc comments in gateway/auth.ts. The first two
// are authenticated and act on the caller's own account (the token names it,
// never a body field); the forgot-password pair is unauthenticated because its
// whole job is recovering an account nobody can currently sign into.

/** New display name only. The server returns the settled profile. */
export function changeDisplayName(displayName: string): Promise<{ player: Player }> {
  return api.post<{ player: Player }>('/auth/change-display-name', { displayName });
}

/**
 * Change the password on the signed-in account. Requires the CURRENT password
 * — the server re-verifies it the same way `/auth/login` does.
 *
 * A Google-linked account (no password ever set) is refused with
 * `{ code: 'no_password' }` and the message "This account signed in with
 * Google and has no password to change." That is how the caller learns the
 * account is Google-only — there is no other signal for it (see the note on
 * `PersonalInfo.tsx`).
 */
export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true }> {
  return api.post<{ ok: true }>('/auth/change-password', { currentPassword, newPassword });
}

/** A password-reset request in flight, mirroring `PendingConfirmation`'s shape. */
export interface PendingPasswordReset {
  pending: true;
  email: string;
}

/**
 * Forgot-password, step 1. Unauthenticated.
 *
 * The response is IDENTICAL whether or not the address has an account, and
 * whether or not that account has a password to reset — that is a deliberate
 * enumeration guard on the server (see the class comment on
 * `/auth/forgot-password` in gateway/auth.ts). Never turn this into a
 * "no account with that email" message at the call site; that would undo the
 * guard the server was written to provide.
 */
export function forgotPassword(email: string): Promise<PendingPasswordReset> {
  return api.post<PendingPasswordReset>('/auth/forgot-password', { email }, { anonymous: true });
}

/** Forgot-password, step 2: email + mailed code + new password. Unauthenticated. */
export function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<{ ok: true }> {
  return api.post<{ ok: true }>(
    '/auth/reset-password',
    { email, code, newPassword },
    { anonymous: true },
  );
}
