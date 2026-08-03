import { computeEquity } from './equity';

/**
 * Insurance underwriting engine (FairPlay §4) — Texas Hold'em only.
 *
 * Five steps, in order: (1) reserve health, (2) exposure budget, (3) single-payout cap,
 * (4) max coverage, (5) quote. The internal RiskFactor margin is applied in step 5 but is NEVER
 * returned — the quote exposes only premium / coverage / odds. The actual loss probability and the
 * RiskFactor stay server-side.
 *
 * Activation: offered only when EXACTLY two players are all-in in the main pot and cards are still
 * to come (board of 3 → insuring the turn, cap 25% of pot; board of 4 → insuring the river, cap
 * 50%). Three or more all-in, or a complete board, → no insurance.
 */

export interface InsuranceScenario {
  insured: [string, string];
  opponent: [string, string];
  board: string[]; // 3 (flop) or 4 (turn)
  pot: number;
  requestedCoverage: number;
}

export interface ReserveState {
  /** Insurance pool balance. */
  reserveBalance: number;
  /** Today's risk budget. */
  dailyBudget: number;
  /** Exposure already committed today. */
  reservedExposure: number;
}

export interface UnderwritingConfig {
  reserveThreshold: number; // $10k platform / $1k league
  singlePayoutPct: number; // 0.05
  riskFactor: number; // hidden house margin (>1)
  turnInsuranceCapPct: number; // board of 3, insuring the turn — 0.25
  riverInsuranceCapPct: number; // board of 4, insuring the river — 0.50
}

export const DEFAULT_UNDERWRITING: UnderwritingConfig = {
  reserveThreshold: 10_000,
  singlePayoutPct: 0.05,
  riskFactor: 1.1,
  turnInsuranceCapPct: 0.25,
  riverInsuranceCapPct: 0.5,
};

/** What the client sees — odds only. No RiskFactor, no loss probability. */
export interface InsuranceQuote {
  premium: number;
  coverage: number;
  /** coverage ÷ premium, e.g. 20 means "pay 5 to receive 100 if you lose". */
  payoutOdds: number;
}

export type UnderwritingResult =
  | { offered: false; reason: string }
  | { offered: true; quote: InsuranceQuote };

/** Insurance is offered only with exactly 2 all-in players and cards still to come. */
export function isInsuranceEligible(allInCount: number, board: readonly string[]): boolean {
  return allInCount === 2 && (board.length === 3 || board.length === 4);
}

export function underwrite(
  scenario: InsuranceScenario,
  reserve: ReserveState,
  config: UnderwritingConfig = DEFAULT_UNDERWRITING,
): UnderwritingResult {
  const { board, pot } = scenario;
  if (board.length !== 3 && board.length !== 4) {
    return { offered: false, reason: 'no_cards_to_come' };
  }

  const equity = computeEquity(scenario.insured, scenario.opponent, board);
  if (equity.lossProbability <= 0) {
    return { offered: false, reason: 'no_risk' }; // a lock can't be insured
  }

  // Step 1 — reserve health.
  if (reserve.reserveBalance < config.reserveThreshold) {
    return { offered: false, reason: 'reserve_below_threshold' };
  }
  // Step 2 — exposure budget.
  const available = reserve.dailyBudget - reserve.reservedExposure;
  if (available <= 0) {
    return { offered: false, reason: 'exposure_exhausted' };
  }
  // Step 3 — single-payout cap.
  const singlePayoutCap = Math.floor(reserve.reserveBalance * config.singlePayoutPct);
  // Step 4 — max insurable coverage (smallest binding constraint).
  const streetCapPct =
    board.length === 3 ? config.turnInsuranceCapPct : config.riverInsuranceCapPct;
  const streetCap = Math.floor(pot * streetCapPct);
  const coverage = Math.min(scenario.requestedCoverage, singlePayoutCap, available, streetCap);
  if (coverage <= 0) {
    return { offered: false, reason: 'no_coverage_available' };
  }

  // Step 5 — quote. RiskFactor margin applied here, never exposed.
  const fairPremium = coverage * equity.lossProbability;
  const premium = Math.max(1, Math.ceil(fairPremium * config.riskFactor));
  const payoutOdds = Math.round((coverage / premium) * 100) / 100;

  return { offered: true, quote: { premium, coverage, payoutOdds } };
}
