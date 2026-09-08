import { Schema, model } from 'mongoose';

/**
 * The processed bytes behind a player's uploaded avatar.
 *
 * Kept in its own collection, not embedded in `PlayerSettings`, so an
 * ordinary settings read (sound toggle, language) never pulls a ~30KB blob
 * along with it. Keyed by playerId — one row per player, a re-upload
 * overwrites it wholesale, and there is never more than one live image to
 * garbage-collect.
 *
 * `data` is ALWAYS the gateway's re-encoded output (see
 * `game-server/src/uploads/avatar-processing.ts`): a 256x256 JPEG with EXIF,
 * ICC and XMP stripped. Nothing here re-derives or re-validates that — this
 * module trusts its one caller, `saveUploadedAvatar`, to have done that
 * before the bytes ever reach Mongo.
 */
export interface AvatarImageDoc {
  _id: string;
  data: Buffer;
  /** Fixed at write time (`AVATAR_OUTPUT_CONTENT_TYPE`) — never taken from a caller. */
  contentType: string;
  createdAt: Date;
  updatedAt: Date;
}

const avatarImageSchema = new Schema<AvatarImageDoc>(
  {
    _id: { type: String, required: true },
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
  },
  { timestamps: true, collection: 'player_avatar_images' },
);

export const AvatarImageModel = model<AvatarImageDoc>('AvatarImage', avatarImageSchema);
