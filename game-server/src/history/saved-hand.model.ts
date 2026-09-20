import mongoose, { Schema, type Model } from 'mongoose';

/**
 * Hands a player has starred in the hand-history panel.
 *
 * SEPARATE FROM THE HAND ITSELF. A hand record is one document for everyone who
 * played it (see hand-record.model.ts); saving is one player's opinion about
 * it, so it cannot live on the shared document — two players starring the same
 * hand must not overwrite each other, and a star must not be visible to the
 * table.
 *
 * A POINTER, NOT A COPY. Only the round id is kept, so a saved hand is always
 * the hand as recorded rather than a snapshot that could drift from it. The
 * cost is that a hand which is ever deleted takes its stars with it, which is
 * the right way round.
 *
 * The compound unique index is the idempotency: starring twice is one row, and
 * the cap below counts rows rather than clicks.
 */

export interface SavedHand {
  playerId: string;
  roundId: string;
  savedAt: Date;
}

const savedHandSchema = new Schema<SavedHand>(
  {
    playerId: { type: String, required: true },
    roundId: { type: String, required: true },
    savedAt: { type: Date, required: true },
  },
  { versionKey: false, collection: 'savedhands' },
);

// One star per player per hand, and the list query is "this player's, newest first".
savedHandSchema.index({ playerId: 1, roundId: 1 }, { unique: true });
savedHandSchema.index({ playerId: 1, savedAt: -1 });

export const SavedHandModel: Model<SavedHand> =
  (mongoose.models.SavedHand as Model<SavedHand>) ??
  mongoose.model<SavedHand>('SavedHand', savedHandSchema);
