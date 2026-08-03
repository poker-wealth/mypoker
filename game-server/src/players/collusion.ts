/**
 * Collusion detection (FairPlay v5.9 §9) — a 0–100 risk score with graduated, mostly-reversible
 * actions. Its output is what the jackpot weighting reads to zero out confirmed colluders.
 *
 * Three iron rules:
 *   1. A GPS + IP/WiFi match bans a pair from the SAME TABLE only — other tables stay open (so a
 *      café or office full of real players is not mass-punished).
 *   2. An associated account group (shared GPS + IP/WiFi) may occupy at most 3 tables at once.
 *   3. AI NEVER auto-bans permanently and NEVER seizes funds. Anything irreversible needs a human.
 *      The automated tiers only flag or apply a same-table restriction; permanent ban + chip seizure
 *      is reachable only through `confirmByHuman()`.
 */

export type CollusionLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CONFIRMED';
export type CollusionAction =
  | 'MONITOR' // flag, keep watching, no interruption
  | 'BAN_SAME_TABLE' // suspected pair off this table only
  | 'HUMAN_REVIEW' // restrict functions, escalate to a person
  | 'SEIZE_AND_PERMABAN'; // human-confirmed only

export const MAX_TABLES_PER_ASSOCIATED_GROUP = 3;

export function levelForScore(score: number): CollusionLevel {
  const s = Math.max(0, Math.min(100, score));
  if (s <= 30) return 'LOW';
  if (s <= 70) return 'MEDIUM';
  return 'HIGH';
}

/**
 * The AUTOMATED action for a risk score. Note the ceiling: even a 100 only reaches HUMAN_REVIEW.
 * Nothing here can permanently ban or seize — that is rule 3.
 */
export function automatedAction(score: number): CollusionAction {
  switch (levelForScore(score)) {
    case 'LOW':
      return 'MONITOR';
    case 'MEDIUM':
      return 'BAN_SAME_TABLE';
    case 'HIGH':
      return 'HUMAN_REVIEW';
    /* c8 ignore next 2 */
    default:
      return 'HUMAN_REVIEW';
  }
}

/** Two accounts are associated when they share BOTH dimensions: GPS AND (IP or WiFi). */
export function isAssociated(
  a: { gps: string; ip: string; wifi: string },
  b: { gps: string; ip: string; wifi: string },
): boolean {
  return a.gps === b.gps && (a.ip === b.ip || a.wifi === b.wifi);
}

/** Rule 2: an associated group may sit at no more than 3 different tables simultaneously. */
export function groupTableLimitOk(distinctTablesInUse: number): boolean {
  return distinctTablesInUse <= MAX_TABLES_PER_ASSOCIATED_GROUP;
}

/**
 * The ONLY path to seizure + permanent ban: an explicit human decision. Seized chips follow the
 * table's scope — platform collusion → Platform Treasury, league collusion → that League Inventory.
 */
export function confirmByHuman(reviewerId: string, scope: 'PLATFORM' | 'LEAGUE'): {
  action: CollusionAction;
  seizeTo: 'TREASURY' | 'LEAGUE_INVENTORY';
  reviewerId: string;
} {
  if (!reviewerId) throw new Error('human confirmation requires a reviewer');
  return {
    action: 'SEIZE_AND_PERMABAN',
    seizeTo: scope === 'PLATFORM' ? 'TREASURY' : 'LEAGUE_INVENTORY',
    reviewerId,
  };
}

/** The behaviour factor the jackpot weighting consumes (v5.9 §5): confirmed colluders → 0. */
export type BehaviorStatus = 'NORMAL' | 'FLAGGED' | 'COLLUDING';

export function behaviorStatusFor(input: {
  collusionConfirmed: boolean;
  flaggedByReview: boolean;
}): BehaviorStatus {
  if (input.collusionConfirmed) return 'COLLUDING';
  if (input.flaggedByReview) return 'FLAGGED';
  return 'NORMAL';
}
