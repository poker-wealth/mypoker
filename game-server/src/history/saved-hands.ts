import { HandRecordModel } from './hand-record.model';
import { SavedHandModel } from './saved-hand.model';

/**
 * Saving a hand from the history panel — the star, and the 15 it counts to.
 *
 * The panel has always drawn "0/15" beside a star and refused to do anything,
 * because nothing behind it existed. The owner's answer, 20 Sep 2026: "You can
 * save game records if needed … Clicking this should save the game record."
 *
 * WHY A CAP AT ALL. It is the reference's, and it is what the screen already
 * promised. Fifteen is a shortlist — the hands worth showing someone — not an
 * archive, and every hand a player has ever played is still in the history
 * behind the scrubber either way. A cap also means this collection cannot grow
 * without bound on one enthusiastic player.
 */

/** The number printed beside the star. Client and server must agree on it. */
export const SAVED_HAND_LIMIT = 15;

export type SaveOutcome = 'saved' | 'already-saved' | 'full';

/**
 * What starring this hand should do, given what is already starred.
 *
 * PURE, and separate from the write, so the rule can be tested without a
 * database — this package has no in-memory Mongo — and so "already saved" is a
 * success rather than an error: a second tap on a starred hand is not a
 * failure, and must not eat one of the fifteen.
 */
export function saveDecision(savedRoundIds: readonly string[], roundId: string): SaveOutcome {
  if (savedRoundIds.includes(roundId)) return 'already-saved';
  if (savedRoundIds.length >= SAVED_HAND_LIMIT) return 'full';
  return 'saved';
}

/** The round ids this player has starred, newest first. */
export async function listSavedHands(playerId: string): Promise<string[]> {
  const rows = await SavedHandModel.find({ playerId }).sort({ savedAt: -1 }).lean<{ roundId: string }[]>();
  return rows.map((r) => r.roundId);
}

/**
 * Did this player actually play this hand?
 *
 * Checked before saving so the star cannot be used to pin arbitrary round ids
 * to an account — the same reasoning as `handsAtTable` only returning hands the
 * caller was dealt into.
 */
export async function playedInHand(playerId: string, roundId: string): Promise<boolean> {
  const hand = await HandRecordModel.exists({ roundId, 'seats.playerId': playerId });
  return hand !== null;
}

/** Star a hand. Idempotent; the caller has already checked the decision. */
export async function saveHand(playerId: string, roundId: string): Promise<void> {
  await SavedHandModel.updateOne(
    { playerId, roundId },
    { $setOnInsert: { playerId, roundId, savedAt: new Date() } },
    { upsert: true },
  );
}

/** Un-star a hand. Removing one that was never starred is not an error. */
export async function unsaveHand(playerId: string, roundId: string): Promise<void> {
  await SavedHandModel.deleteOne({ playerId, roundId });
}
