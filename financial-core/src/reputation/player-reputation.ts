import { Schema, model } from 'mongoose';
import { getPlayerStats } from '../stats/player-stats';

/**
 * Player reputation (spec: 500-start, five tiers).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IRON RULE: reputation NEVER blocks a withdrawal.
 *
 * The spec is unusually blunt about this — "Reputation score affecting
 * withdrawal → critical failure, must fix immediately regardless of milestone."
 * Nothing in this module is imported by the withdrawal path, and nothing here
 * returns anything a withdrawal could branch on. It affects table access and
 * chat; that is the whole of its authority.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The score is DERIVED, not stored:
 *
 *   score = 500 + (100 clean rounds ? +200 : 0) − deductions
 *
 * Only deductions are persisted. Storing the total as well would let the two
 * disagree after any bug, and then there is no way to tell which is right. The
 * round count already lives in the ledger, so it is read from there rather than
 * counted a second time here.
 *
 * The anti-bot score (0–100) is a COMPLETELY SEPARATE system. It is deliberately
 * absent from this file — sharing a module would be the first step toward one
 * leaking into the other, and the spec keeps them apart on purpose.
 */

export const STARTING_SCORE = 500;
export const CLEAN_ROUNDS_FOR_ADVANCE = 100;
export const ADVANCE_BONUS = 200;

/** Deduction sizes, per spec. Anything not in this list is not a valid reason. */
export const DEDUCTIONS = {
  VERIFICATION_FAILED: 20,
  BOT_CONFIRMED: 150,
  COLLUSION_CONFIRMED: 200,
} as const;

export type DeductionReason = keyof typeof DEDUCTIONS;

/**
 * The five bands.
 *
 * Only "Very Poor" is named in the spec (a confirmed collusion, −200, lands
 * there) and the anchors are fixed: 500 on signup, 700 after 100 clean rounds,
 * which is also the agent-eligibility threshold. The boundaries between are
 * mine and want confirming — they are presentation, and no logic branches on
 * them.
 */
export type ReputationBand = 'VERY_POOR' | 'POOR' | 'FAIR' | 'GOOD' | 'TRUSTED';

export function bandFor(score: number): ReputationBand {
  if (score >= 700) return 'TRUSTED';
  if (score >= 600) return 'GOOD';
  if (score >= 500) return 'FAIR';
  if (score >= 350) return 'POOR';
  return 'VERY_POOR';
}

interface DeductionDoc {
  _id: string;
  playerId: string;
  reason: DeductionReason;
  points: number;
  /** Who or what confirmed it — bot and collusion findings need a human. */
  confirmedBy: string;
  note?: string;
  createdAt: Date;
}

const deductionSchema = new Schema<DeductionDoc>(
  {
    _id: { type: String, required: true },
    playerId: { type: String, required: true, index: true },
    reason: { type: String, required: true },
    points: { type: Number, required: true },
    confirmedBy: { type: String, required: true },
    note: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'reputation_deductions' },
);

export const ReputationDeductionModel = model<DeductionDoc>(
  'ReputationDeduction',
  deductionSchema,
);

export interface Reputation {
  score: number;
  band: ReputationBand;
  /** Clean rounds played, for the progress line. */
  roundsPlayed: number;
  /** Rounds still needed to reach the 700 advance; 0 once passed. */
  roundsToAdvance: number;
  /** Total points deducted, so a player can see it isn't arbitrary. */
  deducted: number;
}

export async function getReputation(playerId: string): Promise<Reputation> {
  const [stats, deductions] = await Promise.all([
    getPlayerStats(playerId),
    ReputationDeductionModel.find({ playerId }).lean(),
  ]);

  const deducted = deductions.reduce((sum, d) => sum + d.points, 0);
  const roundsPlayed = stats.handsPlayed;
  const advanced = roundsPlayed >= CLEAN_ROUNDS_FOR_ADVANCE;

  // Floor at zero: a negative reputation is not a concept the spec defines, and
  // a score below zero would make the bands meaningless.
  const score = Math.max(0, STARTING_SCORE + (advanced ? ADVANCE_BONUS : 0) - deducted);

  return {
    score,
    band: bandFor(score),
    roundsPlayed,
    roundsToAdvance: advanced ? 0 : CLEAN_ROUNDS_FOR_ADVANCE - roundsPlayed,
    deducted,
  };
}

/**
 * Record a deduction.
 *
 * Ops-side, and deliberately not reachable from any player-facing route. Bot and
 * collusion findings require a human confirmation per spec — "only if human
 * confirms it's a bot, not automatic" — so `confirmedBy` is required and there is
 * no automatic caller.
 */
export async function deductReputation(input: {
  playerId: string;
  reason: DeductionReason;
  confirmedBy: string;
  /** Idempotency: the same finding must not be able to dock a player twice. */
  findingId: string;
  note?: string;
}): Promise<Reputation> {
  const points = DEDUCTIONS[input.reason];

  await ReputationDeductionModel.updateOne(
    { _id: input.findingId },
    {
      $setOnInsert: {
        _id: input.findingId,
        playerId: input.playerId,
        reason: input.reason,
        points,
        confirmedBy: input.confirmedBy,
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    },
    { upsert: true },
  );

  return getReputation(input.playerId);
}
