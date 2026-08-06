import { Schema, model } from 'mongoose';

/**
 * Per-player preferences, stored server-side so they follow the account rather
 * than the device.
 *
 * These live in financial-core purely because it is the only service with a
 * database. They are NOT money: nothing here may ever gate a withdrawal, alter a
 * balance, or influence settlement. Keep it that way — a settings write must
 * never need a transaction.
 *
 * Everything is optional with a default, so a player who has never opened
 * Settings reads back a complete object rather than nulls the client has to
 * second-guess.
 */

export interface PlayerSettings {
  /** BCP-47 code, or null to keep following the Telegram/browser language. */
  language: string | null;
  sound: boolean;
  /** Haptic feedback on taps and game events. */
  haptics: boolean;
  notifyResults: boolean;
  notifyDeposits: boolean;
  notifyPromos: boolean;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  language: null,
  sound: true,
  haptics: true,
  notifyResults: true,
  notifyDeposits: true,
  // Off by default. Promotional pushes are the ones players resent receiving
  // without asking, and an opt-in costs one tap.
  notifyPromos: false,
};

/**
 * A partial update.
 *
 * Not `Partial<PlayerSettings>`: under exactOptionalPropertyTypes an optional
 * property does not implicitly admit `undefined`, and a parsed request body
 * always does — an absent JSON field arrives as undefined. Spelling it out here
 * keeps the strictness everywhere else rather than casting at the call site.
 */
export type SettingsPatch = {
  [K in keyof PlayerSettings]?: PlayerSettings[K] | undefined;
};

interface SettingsDoc extends PlayerSettings {
  _id: string;
  updatedAt: Date;
}

const settingsSchema = new Schema<SettingsDoc>(
  {
    // playerId is the _id: one row per player, no index needed, and a concurrent
    // first-write from two devices cannot create duplicates.
    _id: { type: String, required: true },
    language: { type: String, default: null },
    sound: { type: Boolean, default: true },
    haptics: { type: Boolean, default: true },
    notifyResults: { type: Boolean, default: true },
    notifyDeposits: { type: Boolean, default: true },
    notifyPromos: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'player_settings' },
);

export const PlayerSettingsModel = model<SettingsDoc>('PlayerSettings', settingsSchema);

/** Never 404s — an untouched account reads back the defaults. */
export async function getSettings(playerId: string): Promise<PlayerSettings> {
  const doc = await PlayerSettingsModel.findById(playerId).lean();
  if (!doc) return { ...DEFAULT_SETTINGS };
  return {
    language: doc.language ?? null,
    sound: doc.sound,
    haptics: doc.haptics,
    notifyResults: doc.notifyResults,
    notifyDeposits: doc.notifyDeposits,
    notifyPromos: doc.notifyPromos,
  };
}

/**
 * Partial update — the client sends only what changed.
 *
 * Upserts, so the first write from a player with no row works without a separate
 * create. Returns the full settled state so the client never has to merge
 * locally and risk drifting from the server.
 */
export async function updateSettings(
  playerId: string,
  patch: SettingsPatch,
): Promise<PlayerSettings> {
  // Strip undefined: { sound: undefined } would otherwise unset a real value.
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) update[key] = value;
  }

  if (Object.keys(update).length === 0) return getSettings(playerId);

  const doc = await PlayerSettingsModel.findByIdAndUpdate(
    playerId,
    { $set: update, $setOnInsert: { _id: playerId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return {
    language: doc?.language ?? null,
    sound: doc?.sound ?? DEFAULT_SETTINGS.sound,
    haptics: doc?.haptics ?? DEFAULT_SETTINGS.haptics,
    notifyResults: doc?.notifyResults ?? DEFAULT_SETTINGS.notifyResults,
    notifyDeposits: doc?.notifyDeposits ?? DEFAULT_SETTINGS.notifyDeposits,
    notifyPromos: doc?.notifyPromos ?? DEFAULT_SETTINGS.notifyPromos,
  };
}
