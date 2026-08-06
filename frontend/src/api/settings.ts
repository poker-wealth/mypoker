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
}

export type SettingsPatch = Partial<PlayerSettings>;

export function fetchSettings(): Promise<PlayerSettings> {
  return api.get<PlayerSettings>('/me/settings');
}

export function patchSettings(patch: SettingsPatch): Promise<PlayerSettings> {
  return api.patch<PlayerSettings>('/me/settings', patch);
}
