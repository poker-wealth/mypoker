import { Schema, model } from 'mongoose';

/**
 * Device push tokens — the address book for the native app's notifications.
 *
 * WHY THIS EXISTS. Telegram needs no address book: a Telegram player's id IS
 * their chat id, so `sendTelegram` derives the destination from the playerId it
 * was already given. Email has an address on the account. The native app has
 * neither — a push token is minted by the OS on the device, changes without
 * warning, and only the device can tell us what it is. So it has to be stored,
 * and stored per DEVICE rather than per player.
 *
 * ── The token is the primary key, deliberately ─────────────────────────────
 *
 * One row per device, keyed by the token itself, rather than a list hanging off
 * the player. Three things fall out of that, all of them wanted:
 *
 *   A player with a phone and a tablet gets two rows and two notifications,
 *   which is what they expect.
 *
 *   Re-registering a token that already exists MOVES it to the new player
 *   instead of duplicating it. That is the case that matters: a shared or
 *   resold handset must stop delivering the previous owner's deposit notices
 *   to whoever holds it now. Keyed by player, the old row would linger and
 *   quietly leak one person's money movements to another.
 *
 *   A dead token can be deleted knowing nothing else refers to it.
 *
 * No PII is held here. A push token identifies an app install, not a person,
 * and the row is dropped on sign-out and on the first delivery that reports the
 * install is gone.
 */

export type PushPlatform = 'android' | 'ios';

interface PushTokenDoc {
  /** The Expo push token, e.g. `ExponentPushToken[xxxxxxxx]`. */
  _id: string;
  playerId: string;
  platform: PushPlatform;
  /** Refreshed on every registration, so an abandoned install is visible. */
  lastSeenAt: Date;
  createdAt: Date;
}

const schema = new Schema<PushTokenDoc>(
  {
    _id: { type: String, required: true },
    // Indexed because the send path's only question is "what are this
    // player's devices" — without it, every notification scans the collection.
    playerId: { type: String, required: true, index: true },
    platform: { type: String, required: true },
    lastSeenAt: { type: Date, default: (): Date => new Date() },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'push_tokens' },
);

export const PushTokenModel = model<PushTokenDoc>('PushToken', schema);

export interface PushDevice {
  token: string;
  platform: PushPlatform;
}

/**
 * Claim a device for a player.
 *
 * Idempotent, and an upsert rather than an insert: the app re-registers on
 * every launch (a token can be rotated by the OS at any time), so this runs
 * constantly with the same values and must stay cheap and silent.
 */
export async function registerPushToken(
  playerId: string,
  token: string,
  platform: PushPlatform,
): Promise<void> {
  await PushTokenModel.updateOne(
    { _id: token },
    { $set: { playerId, platform, lastSeenAt: new Date() } },
    { upsert: true },
  );
}

/**
 * Drop one device.
 *
 * Called on sign-out, and by the sender when a delivery reports the install is
 * gone. Takes the token alone — the caller proving they hold the token is the
 * point, and scoping it to a playerId would leave a stale row behind in exactly
 * the case that matters, where the token now belongs to someone else.
 */
export async function forgetPushToken(token: string): Promise<void> {
  await PushTokenModel.deleteOne({ _id: token });
}

/** Every device we believe this player is holding. */
export async function devicesFor(playerId: string): Promise<PushDevice[]> {
  const rows = await PushTokenModel.find({ playerId }).lean();
  return rows.map((r) => ({ token: r._id, platform: r.platform }));
}
