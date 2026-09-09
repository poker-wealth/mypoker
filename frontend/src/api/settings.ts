import type { AvatarId, AvatarRef } from '@/lib/avatars';
import { api } from './client';

/**
 * Account-level preferences, stored server-side so they follow the player to a
 * new device rather than living in one browser's localStorage.
 *
 * Must mirror financial-core's PlayerSettings exactly.
 */

export interface PlayerSettings {
  /** BCP-47 code, or null to keep following the Telegram/browser language. */
  language: string | null;
  sound: boolean;
  haptics: boolean;
  notifyResults: boolean;
  notifyDeposits: boolean;
  notifyPromos: boolean;
  /**
   * Chosen avatar, an uploaded photo (`UPLOADED_AVATAR`), or null if the
   * player has never picked one. Fallback order on the client when null:
   * OAuth photoUrl, then the player's initial — see components/ui/Avatar.tsx.
   */
  avatarId: AvatarRef | null;
}

/**
 * `avatarId` is narrower here than on `PlayerSettings`: `PATCH /me/settings`
 * only ever accepts a curated id or null (see credential-rules equivalent on
 * the gateway, `player-settings.ts`'s zod schema on the server) — the
 * `UPLOADED_AVATAR` sentinel is written exclusively by `POST /me/avatar`
 * after a real image has been processed and stored, never by this endpoint.
 * Typing it this way makes `patchSettings({ avatarId: UPLOADED_AVATAR })` a
 * compile error instead of a runtime 400 from the server.
 */
export type SettingsPatch = Partial<Omit<PlayerSettings, 'avatarId'>> & {
  avatarId?: AvatarId | null;
};

export function fetchSettings(): Promise<PlayerSettings> {
  return api.get<PlayerSettings>('/me/settings');
}

export function patchSettings(patch: SettingsPatch): Promise<PlayerSettings> {
  return api.patch<PlayerSettings>('/me/settings', patch);
}
