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

/**
 * Sentinel meaning "use the player's own uploaded photo" rather than one of
 * the curated ids above.
 *
 * This is NOT part of `AVATAR_IDS` and never will be — it names a mechanism
 * (an uploaded image, stored separately in `avatar-image.model.ts`), not a
 * curated design. Kept as a single fixed constant rather than an id that
 * embeds a document id or hash: the image row is already keyed by playerId,
 * so there is nothing else for the value to carry, and a fixed literal is one
 * fewer shape a client could try to forge.
 *
 * CRITICAL: this value is never accepted from `PATCH /me/settings` — that
 * route's zod schema validates against `AVATAR_IDS` only (see
 * `http/routes.ts`), so a client sending `avatarId: "uploaded"` there gets a
 * plain 400, the same as any other string outside the curated set. The only
 * way this value is ever written is `saveUploadedAvatar` in
 * `avatar-store.ts`, called from the internal (service-secret) avatar-upload
 * endpoint AFTER an image has actually been processed and stored — so seeing
 * this value on a player's settings is itself proof an image exists for them.
 */
export const UPLOADED_AVATAR = 'uploaded' as const;

/** A player's chosen avatar: curated, their own upload, or none. */
export type AvatarRef = AvatarId | typeof UPLOADED_AVATAR | null;

/** Curated id OR the uploaded-avatar sentinel — the full set `updateSettings` accepts internally. */
function isAvatarRef(value: string): value is AvatarId | typeof UPLOADED_AVATAR {
  return value === UPLOADED_AVATAR || isAvatarId(value);
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
   * `UPLOADED_AVATAR` means "fetch GET /avatars/:playerId" rather than naming
   * a curated id.
   */
  avatarId: AvatarRef;
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
    avatarId: (doc.avatarId as AvatarRef | undefined) ?? null,
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
  // avatarId must be constrained to the curated set, PLUS the uploaded-avatar
  // sentinel (see UPLOADED_AVATAR above). An unvalidated string here is a
  // stored-value injection risk the moment a client interpolates it into
  // markup or an image URL, and it would also let a client store junk the UI
  // cannot render. null (no chosen avatar) is always allowed.
  //
  // This is the ONE place UPLOADED_AVATAR is accepted, and this function has
  // TWO callers with very different trust levels: the public `PATCH
  // /me/settings` route, whose zod schema already restricts avatarId to
  // `AVATAR_IDS` before it ever reaches here (so it can never actually send
  // UPLOADED_AVATAR — this check merely agrees), and `saveUploadedAvatar`
  // below, which sets it after real image bytes have been processed and
  // stored. A client can never reach this value directly; it can only be
  // observed after a genuine upload succeeded.
  if (
    patch.avatarId !== undefined &&
    patch.avatarId !== null &&
    !isAvatarRef(patch.avatarId)
  ) {
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
    avatarId: (doc?.avatarId as AvatarRef | undefined) ?? DEFAULT_SETTINGS.avatarId,
  };
}
