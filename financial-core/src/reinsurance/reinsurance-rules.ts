import { Money } from '../domain/money';

/**
 * Reinsurance — the backstop behind the insurance pool (v5.9 §2, W6/Day 26).
 *
 * The rules that actually protect the money, and why each exists:
 *
 *  • NO CROSS-SUBSIDY. The platform's reinsurance and a league's reinsurance are separate pools.
 *    A league that blows up must not be bailed out with platform money, and vice versa. Every
 *    movement is checked to be within a single scope.
 *  • CAPPED AT 3× the historical maximum single-day payout. A pool is a buffer, not a hoard: past
 *    that, money is left in the insurance pool doing work instead of being locked away.
 *  • CLAWBACK: 20% of the insurance pool's monthly NET PROFIT is swept into reinsurance, and the
 *    obligation expires 24 months after it arises. Loss-making months claw back nothing.
 *  • REINSURANCE ONLY EVER PAYS INTO INSURANCE. It has no path to a player — a direct withdrawal
 *    from the backstop is exactly what looting looks like, and the CB6 whitelist has no such flow.
 *  • TREASURY → INSURANCE requires MULTI-SIG. It is the extreme-case lever (company money topping up
 *    the pool), so it cannot be pulled by one person.
 */

export type ReinsuranceScope = { kind: 'PLATFORM' } | { kind: 'LEAGUE'; leagueId: string };

export const CLAWBACK_BP = 2000n; // 20% of monthly insurance net profit
export const CAP_MULTIPLE = 3n; // 3× historical max single-day payout
export const CLAWBACK_DEADLINE_MONTHS = 24;
export const TREASURY_TOPUP_APPROVALS_REQUIRED = 2; // multi-sig, distinct approvers

export class ReinsuranceRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReinsuranceRuleError';
  }
}

export function scopeKey(scope: ReinsuranceScope): string {
  return scope.kind === 'PLATFORM' ? 'PLATFORM' : scope.leagueId;
}

export function sameScope(a: ReinsuranceScope, b: ReinsuranceScope): boolean {
  return scopeKey(a) === scopeKey(b);
}

/** Reject any movement that would cross a scope boundary (platform ⇄ league). */
export function assertNoCrossSubsidy(from: ReinsuranceScope, to: ReinsuranceScope): void {
  if (!sameScope(from, to)) {
    throw new ReinsuranceRuleError(
      `cross-subsidy blocked: ${scopeKey(from)} cannot fund ${scopeKey(to)}`,
    );
  }
}

/** The pool's ceiling: 3× the largest single day it has ever had to pay. */
export function capFor(historicalMaxSingleDayPayout: Money): Money {
  return Money.fromMicros(historicalMaxSingleDayPayout.toMicros() * CAP_MULTIPLE);
}

/**
 * How much of this month's insurance net profit is swept into reinsurance.
 * A loss-making month contributes nothing — we never claw back money the pool did not make.
 */
export function clawbackFor(monthlyNetProfit: Money): Money {
  if (!monthlyNetProfit.isPositive()) return Money.ZERO;
  return monthlyNetProfit.mulBasisPoints(CLAWBACK_BP);
}

/**
 * What can actually be swept, given the cap: never more than the room left in the pool.
 * A full pool absorbs nothing — the money stays in insurance, working.
 */
export function clawbackTransferable(
  monthlyNetProfit: Money,
  currentBalance: Money,
  historicalMaxSingleDayPayout: Money,
): Money {
  const cap = capFor(historicalMaxSingleDayPayout);
  if (currentBalance.greaterThanOrEqual(cap)) return Money.ZERO;
  const room = cap.subtract(currentBalance);
  const wanted = clawbackFor(monthlyNetProfit);
  return wanted.greaterThan(room) ? room : wanted;
}

/** A clawback obligation expires 24 months after it arose. */
export function clawbackDeadline(accruedAt: Date): Date {
  const d = new Date(accruedAt.getTime());
  d.setUTCMonth(d.getUTCMonth() + CLAWBACK_DEADLINE_MONTHS);
  return d;
}

export function isClawbackExpired(accruedAt: Date, now: Date): boolean {
  return now.getTime() > clawbackDeadline(accruedAt).getTime();
}

/**
 * The backstop: reinsurance tops insurance up when insurance cannot cover a payout.
 * Only ever called for a shortfall, only ever within one scope, and never beyond what it holds.
 */
export function backstopAmount(
  shortfall: Money,
  reinsuranceBalance: Money,
  from: ReinsuranceScope,
  to: ReinsuranceScope,
): Money {
  assertNoCrossSubsidy(from, to);
  if (!shortfall.isPositive()) return Money.ZERO;
  return shortfall.greaterThan(reinsuranceBalance) ? reinsuranceBalance : shortfall;
}

export interface Approval {
  approverId: string;
  at: Date;
}

/**
 * TREASURY → INSURANCE is the extreme-case lever, so it needs multi-sig: two DISTINCT approvers.
 * One person signing twice is not multi-sig, and that is the failure this check exists to catch.
 */
export function assertMultiSig(approvals: readonly Approval[]): void {
  const distinct = new Set(approvals.map((a) => a.approverId));
  if (distinct.size < TREASURY_TOPUP_APPROVALS_REQUIRED) {
    throw new ReinsuranceRuleError(
      `treasury top-up needs ${TREASURY_TOPUP_APPROVALS_REQUIRED} distinct approvers, got ${distinct.size}`,
    );
  }
}
