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
 * The five bands, exactly as FairPlay_v5.9_FINAL_EN §10.1 defines them.
 *
 *   Excellent  900–1000  exclusive frame, priority support, high-stakes access
 *   Good       700–899   standard access (reached after 100 normal rounds)
 *   Average    500–699   new account default, no restrictions
 *   Poor       300–499   blocked from high-stakes tables. Funds NOT affected.
 *   Very Poor    0–299   low-stakes tables only. Funds NOT affected.
 *
 * An earlier version of this file invented its own boundaries and names before
 * the base spec had been read. They were wrong in three ways — wrong cut-offs,
 * wrong labels, and a scale capped at 700 when it runs to 1000.
 *
 * Note the ceiling: nothing currently awards points above the 700 auto-advance,
 * so EXCELLENT is unreachable today. That is a gap in the scoring rules, not in
 * the bands — the spec defines the tier without saying how a player earns their
 * way into it. Left present and honest rather than quietly dropped.
 */
export type ReputationBand = 'VERY_POOR' | 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT';

/** Maximum score the scale allows, per spec. */
export const MAX_SCORE = 1000;

/** Top of the Very Poor band — where a confirmed collusion lands, per spec. */
export const VERY_POOR_CEILING = 299;

export function bandFor(score: number): ReputationBand {
  if (score >= 900) return 'EXCELLENT';
  if (score >= 700) return 'GOOD';
  if (score >= 500) return 'AVERAGE';
  if (score >= 300) return 'POOR';
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

  // Clamped to the documented 0–1000 scale at both ends. A negative reputation
  // is not a concept the spec defines, and a score outside the range would fall
  // through every band.
  const raw = STARTING_SCORE + (advanced ? ADVANCE_BONUS : 0) - deducted;
  let score = Math.min(MAX_SCORE, Math.max(0, raw));

  // Confirmed collusion "drops directly to this tier" (Very Poor), per spec —
  // which is more than its -200 achieves on its own. A new account at 500 would
  // land on 300 (Poor), and one that had advanced to 700 on 500 (Average),
  // neither of which is the stated outcome. So the tier is enforced, not
  // inferred from the arithmetic.
  if (deductions.some((d) => d.reason === 'COLLUSION_CONFIRMED')) {
    score = Math.min(score, VERY_POOR_CEILING);
  }

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
