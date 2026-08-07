import { Schema, model } from 'mongoose';
import { getPlayerStats } from '../stats/player-stats';

/**
 * Reputation FACTS — not the score.
 *
 * financial-core stores what happened (rounds played live in the ledger already;
 * confirmed findings are recorded here) and returns those facts raw. The scoring
 * rules — 500 start, the 100-round advance to 700, deduction sizes, band
 * boundaries, the collusion drop to Very Poor — live in ONE place:
 * game-server/src/players/reputation.ts, and the gateway applies them.
 *
 * This module previously derived the score too. That copy of the rules had
 * already drifted from the canonical module by the time it was found (the VIP
 * ladder next door had different tier titles), which is exactly why derived
 * answers and stored facts now live in different services: facts cannot drift,
 * and rules kept in one place cannot disagree with themselves.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IRON RULE: reputation NEVER blocks a withdrawal.
 *
 * Nothing here is imported by the withdrawal path, and nothing here returns
 * anything a withdrawal could branch on — after this refactor there is not even
 * a score in this file, only history.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Finding reasons, using the canonical names from
 * game-server/src/players/reputation.ts (DEDUCTION). The point VALUES are
 * deliberately absent here — the gateway derives them from the canonical table,
 * so a stored row carries the reason and the rules keep one home.
 */
export type FindingReason = 'CHALLENGE_FAIL' | 'BOT_CONFIRMED' | 'COLLUSION_CONFIRMED';

export const FINDING_REASONS: readonly FindingReason[] = [
  'CHALLENGE_FAIL',
  'BOT_CONFIRMED',
  'COLLUSION_CONFIRMED',
];

interface FindingDoc {
  _id: string;
  playerId: string;
  reason: FindingReason;
  /** Who confirmed it — bot and collusion findings need a human, per spec. */
  confirmedBy: string;
  note?: string;
  createdAt: Date;
}

const findingSchema = new Schema<FindingDoc>(
  {
    _id: { type: String, required: true },
    playerId: { type: String, required: true, index: true },
    reason: { type: String, required: true },
    confirmedBy: { type: String, required: true },
    note: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'reputation_deductions' },
);

export const ReputationFindingModel = model<FindingDoc>('ReputationDeduction', findingSchema);

/** The durable facts a reputation score is derived FROM. */
export interface ReputationFacts {
  roundsPlayed: number;
  /** Every confirmed finding's reason, oldest first. */
  findings: FindingReason[];
}

export async function getReputationFacts(playerId: string): Promise<ReputationFacts> {
  const [stats, findings] = await Promise.all([
    getPlayerStats(playerId),
    ReputationFindingModel.find({ playerId }).sort({ createdAt: 1 }).lean(),
  ]);

  return {
    roundsPlayed: stats.handsPlayed,
    findings: findings.map((f) => f.reason),
  };
}

/**
 * Record a confirmed finding.
 *
 * Ops-side, not reachable from any player-facing route, and idempotent on the
 * finding id — a retried ops action must not record one offence twice.
 */
export async function recordFinding(input: {
  playerId: string;
  reason: FindingReason;
  confirmedBy: string;
  findingId: string;
  note?: string;
}): Promise<ReputationFacts> {
  await ReputationFindingModel.updateOne(
    { _id: input.findingId },
    {
      $setOnInsert: {
        _id: input.findingId,
        playerId: input.playerId,
        reason: input.reason,
        confirmedBy: input.confirmedBy,
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    },
    { upsert: true },
  );

  return getReputationFacts(input.playerId);
}
