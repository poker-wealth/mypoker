/**
 * Reputation (FairPlay v5.9 §10.1) — a 0–1000 score that governs table access and chat.
 *
 * THE IRON RULE, enforced structurally below: reputation NEVER affects a player's money. A player
 * with the worst possible reputation can still withdraw every cent — reputation gates which tables
 * they may sit at and whether they may chat, nothing else. `withdrawalGate()` deliberately ignores
 * the score, and the tests assert it.
 */

export type ReputationTier = 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'POOR' | 'VERY_POOR';

export const NEW_ACCOUNT_SCORE = 500; // starts at Average
export const GOOD_STANDING_SCORE = 700; // reached after 100 normal rounds
export const NORMAL_ROUNDS_TO_GOOD = 100;
export const MIN_SCORE = 0;
export const MAX_SCORE = 1000;

/** Point deductions (v5.9 §10.1). Each is applied only AFTER the relevant human/automated finding. */
export const DEDUCTION = {
  CHALLENGE_FAIL: 20,
  BOT_CONFIRMED: 150,
  COLLUSION_CONFIRMED: 200,
} as const;

interface TierBand {
  tier: ReputationTier;
  min: number;
  /** Highest stake table this tier may enter (Infinity = no cap). */
  maxStakeAccess: number;
  canChat: boolean;
}

const HIGH_STAKES_FLOOR = 5000; // "high-stakes" table threshold (micro-units handled by caller)

const BANDS: readonly TierBand[] = [
  { tier: 'EXCELLENT', min: 900, maxStakeAccess: Infinity, canChat: true },
  { tier: 'GOOD', min: 700, maxStakeAccess: Infinity, canChat: true },
  { tier: 'AVERAGE', min: 500, maxStakeAccess: Infinity, canChat: true },
  { tier: 'POOR', min: 300, maxStakeAccess: HIGH_STAKES_FLOOR - 1, canChat: true }, // no high-stakes
  { tier: 'VERY_POOR', min: 0, maxStakeAccess: HIGH_STAKES_FLOOR - 1, canChat: false }, // low-stakes only, no chat
];

export function clampScore(score: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(score)));
}

export function tierOf(score: number): ReputationTier {
  const s = clampScore(score);
  return BANDS.find((b) => s >= b.min)!.tier;
}

function bandOf(score: number): TierBand {
  const s = clampScore(score);
  return BANDS.find((b) => s >= b.min)!;
}

/** Advance a new account to Good standing once it clears its first 100 normal rounds. */
export function scoreAfterNormalRounds(score: number, normalRounds: number): number {
  if (score === NEW_ACCOUNT_SCORE && normalRounds >= NORMAL_ROUNDS_TO_GOOD) {
    return GOOD_STANDING_SCORE;
  }
  return score;
}

export function deduct(score: number, points: number): number {
  return clampScore(score - Math.abs(points));
}

/** Top of the Very Poor band — where a confirmed collusion lands, per spec. */
export const VERY_POOR_CEILING = 299;

/** A stored human-confirmed finding, as the Financial Core records it. */
export type FindingReason = 'CHALLENGE_FAIL' | 'BOT_CONFIRMED' | 'COLLUSION_CONFIRMED';

/**
 * Derive a player's score from durable facts: rounds played and confirmed findings.
 *
 * This is THE derivation — the Financial Core stores the facts (it has the
 * database) and the gateway calls this to turn them into a score, so the scoring
 * rules live in exactly one place. A copy of these rules previously grew in
 * financial-core and its VIP titles had already drifted from this module's by
 * the time it was found; that is the failure mode this function exists to end.
 *
 * Spec §10.1 details honoured here:
 *   • 500 start, auto-advance to 700 after 100 normal rounds, deductions after.
 *   • A confirmed collusion "drops directly to this tier" (Very Poor) — which
 *     plain subtraction does not achieve: 500−200=300 is the floor of POOR, and
 *     an advanced 700−200=500 is AVERAGE. So the ceiling is enforced, not
 *     inferred from arithmetic.
 */
export function scoreFor(roundsPlayed: number, findings: readonly FindingReason[]): number {
  const base = scoreAfterNormalRounds(NEW_ACCOUNT_SCORE, roundsPlayed);
  const deducted = findings.reduce((sum, r) => sum + DEDUCTION[r], 0);
  let score = clampScore(base - deducted);
  if (findings.includes('COLLUSION_CONFIRMED')) score = Math.min(score, VERY_POOR_CEILING);
  return score;
}

/** May this reputation sit at a table of the given stake? Access only — never money. */
export function canAccessTable(score: number, stake: number): boolean {
  return stake <= bandOf(score).maxStakeAccess;
}

export function canChat(score: number): boolean {
  return bandOf(score).canChat;
}

/**
 * THE FIREWALL. Withdrawal eligibility does not depend on reputation, full stop. This function takes
 * the score only to make the independence explicit and testable: whatever it is, the answer is the
 * same. Fund safety is governed by the Financial Core (KYC / circuit breakers), never by standing.
 */
export function withdrawalGate(_reputationScore: number): { allowedByReputation: true; reason: string } {
  return {
    allowedByReputation: true,
    reason: 'reputation never affects withdrawals (v5.9 §10.1)',
  };
}
