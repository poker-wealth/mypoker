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
