import { HandRecordModel } from './hand-record.model';
import { deriveStats, netByPosition, type HandRecord, type PlayerHandStats, type Position } from './hand-record';

/**
 * Reading and writing hand histories.
 *
 * Thin on purpose: the derivations live in `hand-record.ts` as pure functions
 * so they can be tested without a database, and this file is only the part that
 * cannot be — the queries.
 */

/**
 * Save one hand.
 *
 * NEVER THROWS TO THE CALLER. A hand history is a record of something that has
 * already happened and has already been paid: the money moved through
 * `transfer()` before this is called, and it is not conditional on this
 * succeeding. If Mongo is unreachable, the right outcome is a lost statistic
 * and a logged error — not a table that stops dealing because it could not
 * write to an analytics collection.
 *
 * Duplicate `roundId` is swallowed quietly rather than logged as an error: it
 * means the hand is already recorded, which is the desired end state. Logging
 * it would fill the log with noise on every retry.
 */
export async function recordHand(record: HandRecord): Promise<void> {
  try {
    await HandRecordModel.create(record);
  } catch (err) {
    const duplicate =
      typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
    if (duplicate) return;
    console.error(`[history] could not record hand ${record.roundId}:`, err);
  }
}

/** A player's hands, newest first, within an optional window. */
export async function handsFor(
  playerId: string,
  window?: { from?: Date; to?: Date },
  limit = 5_000,
): Promise<HandRecord[]> {
  const query: Record<string, unknown> = { 'seats.playerId': playerId };
  if (window?.from || window?.to) {
    query['playedAt'] = {
      ...(window.from ? { $gte: window.from } : {}),
      // EXCLUSIVE upper bound, like every other window in this codebase
      // (`dayWindow`/`rangeWindow` in financial-core). A `$lte` on a date
      // silently includes or excludes the last millisecond depending on how
      // the caller rounded.
      ...(window.to ? { $lt: window.to } : {}),
    };
  }

  return HandRecordModel.find(query).sort({ playedAt: -1 }).limit(limit).lean<HandRecord[]>();
}

export interface HandStatsResult {
  stats: PlayerHandStats;
  byPosition: Record<Position, number | null>;
}

/**
 * Everything the Data page's analysis half needs, in one round trip.
 *
 * One query and two pure derivations rather than an aggregation per card: the
 * hands are already in memory, and six separate aggregation pipelines over the
 * same documents is six chances for two cards to disagree about the same
 * player.
 */
export async function handStatsFor(
  playerId: string,
  window?: { from?: Date; to?: Date },
): Promise<HandStatsResult> {
  const records = await handsFor(playerId, window);
  return {
    stats: deriveStats(records, playerId),
    byPosition: netByPosition(records, playerId),
  };
}
