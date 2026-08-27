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

/**
 * Curated avatar set. The server is the authority on what exists: a client
 * must never be able to store an id we don't recognize, since it would
 * eventually get interpolated into markup or an image URL. Each id pairs a
 * two-stop brand gradient with a glyph, the same way the game catalogue tiles
 * render.
 */
export const AVATAR_IDS = [
  'a-spade',
  'a-heart',
  'a-diamond',
  'a-club',
  'a-crown',
  'a-bull',
  'a-packet',
  'a-fan',
  'a-star',
  'a-flame',
  'a-clover',
  'a-dragon',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

function isAvatarId(value: string): value is AvatarId {
  return (AVATAR_IDS as readonly string[]).includes(value);
}

export interface PlayerSettings {
  /** BCP-47 code, or null to keep following the Telegram/browser language. */
  language: string | null;
  sound: boolean;
  /** Haptic feedback on taps and game events. */
  haptics: boolean;
  notifyResults: boolean;
  notifyDeposits: boolean;
  notifyPromos: boolean;
  /**
   * Chosen avatar, or null if the player has never picked one. Fallback order
   * on the client when null: OAuth `photoUrl`, then the player's initial.
   */
  avatarId: AvatarId | null;
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
  avatarId: null,
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
    avatarId: { type: String, default: null },
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
    avatarId: (doc.avatarId as AvatarId | null | undefined) ?? null,
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
  // avatarId must be constrained to the curated set. An unvalidated string
  // here is a stored-value injection risk the moment a client interpolates it
  // into markup or an image URL, and it would also let a client store junk
  // the UI cannot render. null (no chosen avatar) is always allowed.
  if (patch.avatarId !== undefined && patch.avatarId !== null && !isAvatarId(patch.avatarId)) {
    throw new RangeError(`unknown avatarId: ${patch.avatarId}`);
  }

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
    avatarId: (doc?.avatarId as AvatarId | null | undefined) ?? DEFAULT_SETTINGS.avatarId,
  };
}
