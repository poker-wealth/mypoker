import mongoose, { Schema, type Model } from 'mongoose';
import { canUpload, afterUpload, type UploadHistory, type UploadDecision } from './avatar-upload-rules';

/**
 * Storage for avatar-upload rate-limit history.
 *
 * Deliberately thin, same split as `otp-store.ts`: every decision lives in
 * `avatar-upload-rules.ts`, which has no database, so the rules are testable
 * on their own and this file is only a persistence port plus a Mongoose
 * adapter for it.
 */

export interface UploadHistoryPersistence {
  get(playerId: string): Promise<UploadHistory | null>;
  put(playerId: string, value: UploadHistory): Promise<void>;
}

export interface AvatarUploadLimiter {
  /** Non-mutating: may this player upload right now? */
  check(playerId: string, now?: number): Promise<UploadDecision>;
  /** Call once an upload has actually been accepted and stored. */
  record(playerId: string, now?: number): Promise<void>;
  /**
   * Decide AND consume the slot in one step.
   *
   * `check` then `record` is the docs/TRAPS.md §14 shape: the route checked,
   * then re-encoded the image with sharp and posted it upstream — hundreds of
   * milliseconds — and only then recorded. Two uploads arriving together both
   * passed a check neither had yet consumed, which is the entire point of the
   * limit on the most expensive route in the gateway.
   *
   * Note what this costs: a reservation is spent even if the image is then
   * rejected. That is deliberate. The resource being protected is the re-encode
   * that happens AFTER this returns, and someone posting junk in a loop is
   * exactly who the limit is for. A slot released on rejection would hand that
   * back for free.
   */
  reserve(playerId: string, now?: number): Promise<UploadDecision>;
}

export function createAvatarUploadLimiter(persistence: UploadHistoryPersistence): AvatarUploadLimiter {
  return {
    async check(playerId, now = Date.now()) {
      return canUpload(await persistence.get(playerId), now);
    },
    async record(playerId, now = Date.now()) {
      const existing = await persistence.get(playerId);
      await persistence.put(playerId, afterUpload(existing, now));
    },
    async reserve(playerId, now = Date.now()) {
      const existing = await persistence.get(playerId);
      const decision = canUpload(existing, now);
      // Only a granted slot is consumed — a refusal must not extend its own
      // cooldown, or a client retrying politely would never get back in.
      if (decision.ok) await persistence.put(playerId, afterUpload(existing, now));
      return decision;
    },
  };
}

interface UploadHistoryDoc extends UploadHistory {
  _id: string;
}

const schema = new Schema<UploadHistoryDoc>(
  {
    // playerId is the _id: one row per player, upserted in place.
    _id: { type: String, required: true },
    count: { type: Number, required: true },
    windowStart: { type: Number, required: true },
    lastUploadAt: { type: Number, required: true },
  },
  { collection: 'avatar_upload_history', versionKey: false },
);

export const AvatarUploadHistoryModel: Model<UploadHistoryDoc> =
  (mongoose.models.AvatarUploadHistory as Model<UploadHistoryDoc>) ??
  mongoose.model<UploadHistoryDoc>('AvatarUploadHistory', schema);

export const mongoUploadHistoryPersistence: UploadHistoryPersistence = {
  async get(playerId) {
    const doc = await AvatarUploadHistoryModel.findById(playerId).lean();
    if (!doc) return null;
    return { count: doc.count, windowStart: doc.windowStart, lastUploadAt: doc.lastUploadAt };
  },
  async put(playerId, value) {
    await AvatarUploadHistoryModel.findByIdAndUpdate(
      playerId,
      { $set: value, $setOnInsert: { _id: playerId } },
      { upsert: true },
    );
  },
};

/** The one the gateway uses in production. */
export const avatarUploadLimiter: AvatarUploadLimiter = createAvatarUploadLimiter(
  mongoUploadHistoryPersistence,
);
