import { api } from './client';

/** The player identity the gateway returns at login. */
export interface Player {
  playerId: string;
  displayName: string;
  username: string | null;
  photoUrl: string | null;
  telegramId: number | null;
  vipTier: number;
  /**
   * 'ops' for a platform administrator, 'player' for everyone else. Drives which
   * app the client renders on the admin host. The server re-checks the token on
   * every /admin call regardless — this only decides what to SHOW.
   */
  role: 'player' | 'ops';
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

/** Re-read the signed-in player (e.g. after a reload, to confirm the token is still good). */
export function fetchMe(): Promise<Player> {
  return api.get<Player>('/auth/me');
}

export function signupWithEmail(email: string, passwordPlain: string, displayName?: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/signup', { email, password: passwordPlain, displayName }, { anonymous: true });
}

export function loginWithEmail(email: string, passwordPlain: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/login', { email, password: passwordPlain }, { anonymous: true });
}

export function loginWithGoogle(token: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/google', { credential: token, idToken: token }, { anonymous: true });
}
