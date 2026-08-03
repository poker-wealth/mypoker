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

/** Dev-only sign-in for working in a plain browser. Rejected unless the server runs with it enabled. */
export function loginAsDevPlayer(): Promise<LoginResponse> {
  return api.post<LoginResponse>('/auth/dev', {}, { anonymous: true });
}

/** Re-read the signed-in player (e.g. after a reload, to confirm the token is still good). */
export function fetchMe(): Promise<Player> {
  return api.get<Player>('/auth/me');
}
