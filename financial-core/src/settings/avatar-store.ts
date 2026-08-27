import { AvatarImageModel } from './avatar-image.model';
import { updateSettings, UPLOADED_AVATAR } from './player-settings';

/**
 * Storage for uploaded avatar images.
 *
 * The dangerous work — magic-byte sniffing, the pixel-bomb bound, stripping
 * EXIF by re-encoding — happens upstream in the gateway
 * (`game-server/src/uploads/avatar-processing.ts`), the only public entry
 * point for an uploaded file. By the time bytes reach `saveUploadedAvatar`
 * they are assumed to already be a small, freshly re-encoded JPEG. This module
 * does not re-run those checks; it only guards against a caller sending
 * something absurdly large as a defence-in-depth backstop, since this is an
 * `/internal` endpoint reachable by anything holding the service secret, not
 * only the one gateway code path that currently calls it.
 */

/**
 * A generous ceiling well above the ~30KB a 256x256 JPEG actually produces.
 * Not a quality target — just a backstop against a misbehaving or future
 * caller writing something unreasonable into Mongo.
 */
export const MAX_STORED_AVATAR_BYTES = 200_000;

/** Fixed at write time. Never taken from a caller — see avatar-image.model.ts. */
const STORED_CONTENT_TYPE = 'image/jpeg';

/**
 * Store `data` as `playerId`'s avatar image and mark their settings to use
 * it. Both writes happen together: a row with no matching settings flag
 * would never be served through the normal `avatarId === UPLOADED_AVATAR`
 * path, and a flag with no row would 404 on every fetch. Neither op is
 * conditional on the other succeeding first-time — a re-upload simply
 * overwrites both.
 */
export async function saveUploadedAvatar(playerId: string, data: Buffer): Promise<void> {
  if (data.length === 0) {
    throw new RangeError('avatar image is empty');
  }
  if (data.length > MAX_STORED_AVATAR_BYTES) {
    throw new RangeError(`avatar image is too large (${data.length} bytes)`);
  }

  await AvatarImageModel.findByIdAndUpdate(
    playerId,
    { $set: { data, contentType: STORED_CONTENT_TYPE }, $setOnInsert: { _id: playerId } },
    { upsert: true },
  );

  await updateSettings(playerId, { avatarId: UPLOADED_AVATAR });
}

export interface StoredAvatarImage {
  data: Buffer;
  contentType: string;
  updatedAt: Date;
}

/** The stored image for `playerId`, or null if they have never uploaded one. */
export async function getAvatarImage(playerId: string): Promise<StoredAvatarImage | null> {
  const doc = await AvatarImageModel.findById(playerId).lean();
  if (!doc) return null;
  return { data: toBuffer(doc.data), contentType: doc.contentType, updatedAt: doc.updatedAt };
}

/**
 * `.lean()` on a Buffer-typed field can hand back a plain Node Buffer OR the
 * driver's raw BSON `Binary` wrapper (whose bytes live under `.buffer`, and
 * which is NOT itself a Uint8Array in the bson versions this repo pins) —
 * normalize explicitly rather than trust either shape. Getting this wrong
 * silently produces an empty image rather than an error, which is exactly
 * the kind of check-that-passes-without-doing-the-real-thing docs/TRAPS.md §1
 * warns about — this function exists so it is only gotten right once.
 */
function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value && typeof value === 'object' && 'buffer' in value) {
    return Buffer.from((value as { buffer: Uint8Array }).buffer);
  }
  return Buffer.from(value as Uint8Array);
}
