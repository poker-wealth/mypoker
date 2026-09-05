import mongoose, { Schema, type Model } from 'mongoose';

/**
 * Administrator overrides for DERIVED player values.
 *
 * The owner asked for reputation and VIP to be editable. They are not stored
 * anywhere — they are computed, by `src/players/`, from facts financial-core
 * holds: rounds played, findings, cumulative settled volume. So "editable" has
 * two possible meanings and only one of them is safe:
 *
 *   rewrite the FACTS — set roundsPlayed to 500, or lifetime volume to $1m.
 *     The profile would then contradict the ledger it is derived from, and the
 *     figures would be indistinguishable from a real history that never
 *     happened. That is the same failure as typing a balance into a form.
 *
 *   override the RESULT — record that an administrator set this player's tier
 *     to 5, who did it and why, and show it as an override.
 *
 * This is the second. The facts stay exactly as the ledger says; the override
 * sits beside them and is always attributable. Clearing it returns the player
 * to their computed value, which is why nothing is destroyed by setting one.
 *
 * Lives in game-server rather than financial-core deliberately: financial-core
 * returns facts and holds no opinion, and an override is an opinion.
 */
export interface PlayerOverrideDoc {
  /** playerId. One document per player, created on first override. */
  _id: string;
  /** Replaces the computed reputation score. Absent = use the computed one. */
  reputationScore?: number;
  /**
   * Replaces the computed VIP tier. Absent = use the computed one.
   *
   * The tier IDENTIFIER ('V1'…'V5'), not a number and not the title. The title
   * is derived from it by `vipSpec`, so an override cannot produce a tier whose
   * name disagrees with its privileges — storing the title instead would allow
   * exactly that.
   */
  vipTier?: string;
  /** The administrator who last changed this. From the verified token, never a body. */
  setBy: string;
  /** Why. Required by the route — an unexplained override is not reviewable. */
  reason: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<PlayerOverrideDoc>(
  {
    _id: { type: String, required: true },
    // No defaults: absent means "not overridden", and a default would make
    // every document claim an override of zero the moment it was created.
    reputationScore: { type: Number },
    vipTier: { type: String },
    setBy: { type: String, required: true },
    reason: { type: String, required: true },
  },
  { timestamps: true, versionKey: false, collection: 'player_overrides' },
);

export const PlayerOverrideModel: Model<PlayerOverrideDoc> =
  (mongoose.models.PlayerOverride as Model<PlayerOverrideDoc>) ??
  mongoose.model<PlayerOverrideDoc>('PlayerOverride', schema);
