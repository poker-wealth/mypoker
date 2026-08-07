/**
 * Insurance underwriting (FairPlay_v5.9_FINAL_EN §4).
 *
 * Core principle, quoted: "Assess capacity FIRST. Generate quote LAST. UI NEVER
 * exposes RiskFactor."
 *
 * Five steps, in order, each able to decline:
 *
 *   1. Reserve health   — reserve below the floor, insurance is off entirely
 *   2. Exposure         — daily risk budget already committed
 *   3. Single payout    — this payout would exceed 5% of reserve
 *   4. Max coverage     — what inventory + reinsurance can actually cover
 *   5. Quote            — odds out, and nothing else
 *
 * Pure and synchronous on purpose. The spec wants this pre-computed at flop and
 * turn and cached, so the all-in reads in under 10ms — which is only possible if
 * the decision needs no I/O. Feed it a snapshot; it does arithmetic.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RiskFactor NEVER leaves this module.
 *
 * It is an input to the arithmetic and never a field on the result. The spec
 * states it twice, and the reason is competitive: a player who can see the
 * platform's risk multiplier can infer the book's position and price against it.
 * `Quote` carries odds and a payout cap. There is nothing else on it to leak.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Which system is underwriting. Platform and League are entirely separate pools. */
export type InsuranceSystem = 'PLATFORM' | 'LEAGUE';

/** Reserve floors below which insurance is not offered at all, per spec. */
export const RESERVE_FLOOR: Record<InsuranceSystem, number> = {
  PLATFORM: 10_000_000_000, // $10,000
  LEAGUE: 1_000_000_000, // $1,000
};

/** Hardcoded by the spec, and explicitly NOT admin-configurable. */
export const MAX_SINGLE_PAYOUT_BPS = 500; // 5% of reserve
export const MAX_DAILY_PAYOUT_BPS = 1500; // 15% of reserve

export type DeclineReason =
  | 'RESERVE_BELOW_FLOOR'
  | 'NO_RISK_BUDGET'
  | 'EXCEEDS_SINGLE_PAYOUT_CAP'
  | 'INSUFFICIENT_COVERAGE'
  | 'NOT_TWO_PLAYER_ALL_IN';

export interface UnderwritingSnapshot {
  system: InsuranceSystem;
  /** Current reserve, micro-USD. */
  reserve: number;
  /** Daily risk budget already committed, micro-USD. */
  reservedExposure: number;
  /** What the inventory pool can cover right now, micro-USD. */
  inventory: number;
  /** Reinsurance backstop, micro-USD. */
  reinsurance: number;
  /**
   * The platform's risk multiplier.
   *
   * Never returned, never logged alongside a quote, never sent to a client. See
   * the module header. Defaults to 1.0, which is also what a failed HMAC
   * validation resets it to per spec.
   */
  riskFactor: number;
}

export interface InsuranceRequest {
  /** What the player stands to lose if the hand goes against them, micro-USD. */
  exposure: number;
  /** How many players are all-in. Insurance is a two-player instrument. */
  allInPlayers: number;
  /** Player's equity in the pot, 0–1. Drives the odds. */
  equity: number;
}

export interface Quote {
  offered: true;
  /** Decimal odds, two places, e.g. '1.85'. The ONLY number the UI shows. */
  odds: string;
  /** Most this policy can pay out, micro-USD. */
  maxPayout: number;
  /** Premium the player pays, micro-USD. */
  premium: number;
}

export interface Declined {
  offered: false;
  reason: DeclineReason;
}

export type UnderwritingResult = Quote | Declined;

const decline = (reason: DeclineReason): Declined => ({ offered: false, reason });

/**
 * Run the five steps.
 *
 * Order matters and matches the spec: capacity is assessed before a quote is
 * generated, so a decline never involves computing a price we cannot honour.
 */
export function underwrite(
  snapshot: UnderwritingSnapshot,
  request: InsuranceRequest,
): UnderwritingResult {
  // Step 0 — the show/skip rule. Two players all-in activates; three or more
  // silently skips, per spec. "Silently" is load-bearing: with three players the
  // prompt must not appear at all, rather than appearing and declining, which
  // would tell the table something about the hand.
  if (request.allInPlayers !== 2) return decline('NOT_TWO_PLAYER_ALL_IN');

  // Step 1 — reserve health. Below the floor, the entry is hidden entirely.
  if (snapshot.reserve < RESERVE_FLOOR[snapshot.system]) {
    return decline('RESERVE_BELOW_FLOOR');
  }

  // Step 2 — exposure. available = daily budget − already reserved.
  const dailyBudget = Math.floor((snapshot.reserve * MAX_DAILY_PAYOUT_BPS) / 10_000);
  const available = dailyBudget - snapshot.reservedExposure;
  if (available <= 0) return decline('NO_RISK_BUDGET');

  // Step 3 — single payout cap. 5% of reserve, hardcoded.
  const singleCap = Math.floor((snapshot.reserve * MAX_SINGLE_PAYOUT_BPS) / 10_000);
  if (request.exposure > singleCap) return decline('EXCEEDS_SINGLE_PAYOUT_CAP');

  // Step 4 — what can actually be covered, bounded by every constraint at once.
  const maxPayout = Math.min(
    request.exposure,
    singleCap,
    available,
    snapshot.inventory + snapshot.reinsurance,
  );
  if (maxPayout <= 0) return decline('INSUFFICIENT_COVERAGE');

  // Step 5 — the quote. Fair odds are 1/equity; riskFactor is the platform's
  // margin on top. Both stay here: only the resulting number goes out.
  const fairOdds = request.equity > 0 ? 1 / request.equity : 0;
  const odds = fairOdds / Math.max(snapshot.riskFactor, 1);
  if (!Number.isFinite(odds) || odds <= 1) return decline('INSUFFICIENT_COVERAGE');

  return {
    offered: true,
    odds: odds.toFixed(2),
    maxPayout,
    premium: Math.floor(maxPayout / odds),
  };
}
