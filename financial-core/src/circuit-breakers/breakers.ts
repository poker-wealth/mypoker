import { Money } from '../domain/money';
import { AccountType } from '../domain/account-types';
import { isFlowAllowed } from '../clearing/clearing-rules';
import { WithdrawalModel } from '../withdrawal/withdrawal.model';
import { SecurityLogModel } from '../security/security-log.model';
import { alertOps } from '../lib/alert';

/**
 * The seven circuit breakers (FairPlay §3.8), as evaluable functions.
 *
 * Each returns a BreakerEvent. When a breaker trips it writes a security_log entry and fires an ops
 * alert, then returns the action the caller must take. CB6 is additionally enforced inline in
 * transfer() (every fund movement); the function here is the standalone checker.
 *
 * Breakers that need a data source not yet built (insurance pool, jackpot counters) take the
 * relevant metric as a parameter, so their decision logic is complete and tested today and the live
 * feed plugs in when that module lands. CB4/CB5 already run against the real withdrawals collection.
 */

export interface BreakerEvent {
  id: string;
  name: string;
  tripped: boolean;
  /** The action the caller must enforce when tripped (e.g. 'disable_insurance_sales'). */
  action: string | null;
  detail: Record<string, unknown>;
}

// Default thresholds from the spec.
export const CB1_PLATFORM_THRESHOLD = Money.fromDecimalString('10000');
export const CB1_LEAGUE_THRESHOLD = Money.fromDecimalString('1000');
export const CB2_DAILY_PAYOUT_BP = 1500n; // 15%
export const CB3_JACKPOT_TRIGGERS_PER_HOUR = 3;

async function trip(
  id: string,
  name: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<BreakerEvent> {
  await SecurityLogModel.create([{ event: `CIRCUIT_BREAKER_${id}`, detail: { name, action, ...detail } }]);
  await alertOps(`Circuit breaker ${id} tripped: ${name} → ${action}`, detail);
  return { id, name, tripped: true, action, detail };
}

function ok(id: string, name: string): BreakerEvent {
  return { id, name, tripped: false, action: null, detail: {} };
}

/** CB1 — insurance pool below its minimum reserve → stop selling insurance (existing policies pay out). */
export async function evaluateCB1(
  insuranceBalance: Money,
  threshold: Money,
): Promise<BreakerEvent> {
  if (insuranceBalance.lessThan(threshold)) {
    return trip('CB1', 'Insurance pool level', 'disable_insurance_sales', {
      balance: insuranceBalance.toString(),
      threshold: threshold.toString(),
    });
  }
  return ok('CB1', 'Insurance pool level');
}

/** CB2 — today's insurance payouts exceed 15% of the pool → suspend insurance for 24h. */
export async function evaluateCB2(
  todayPayout: Money,
  poolBalance: Money,
): Promise<BreakerEvent> {
  const cap = poolBalance.mulBasisPoints(CB2_DAILY_PAYOUT_BP);
  if (todayPayout.greaterThan(cap)) {
    return trip('CB2', 'Daily payout rate', 'suspend_insurance_24h', {
      todayPayout: todayPayout.toString(),
      cap: cap.toString(),
    });
  }
  return ok('CB2', 'Daily payout rate');
}

/** CB3 — a table's Mini jackpot triggered ≥3 times in an hour → freeze that table's jackpot. */
export async function evaluateCB3(
  tableId: string,
  triggersLastHour: number,
): Promise<BreakerEvent> {
  if (triggersLastHour >= CB3_JACKPOT_TRIGGERS_PER_HOUR) {
    return trip('CB3', 'Jackpot anomaly', 'freeze_table_jackpot', { tableId, triggersLastHour });
  }
  return ok('CB3', 'Jackpot anomaly');
}

/** CB4 — one account requested more than `limit` withdrawals in the last hour → freeze its withdrawals. */
export async function evaluateCB4(
  playerAccountId: string,
  limit: number,
  windowMs = 3_600_000,
): Promise<BreakerEvent> {
  const since = new Date(Date.now() - windowMs);
  const count = await WithdrawalModel.countDocuments({
    playerAccountId,
    createdAt: { $gte: since },
  });
  if (count > limit) {
    return trip('CB4', 'Abnormal account withdrawal', 'freeze_account_withdrawals_1h', {
      playerAccountId,
      count,
      limit,
    });
  }
  return ok('CB4', 'Abnormal account withdrawal');
}

/** CB5 — platform-wide withdrawal count in the last hour exceeds threshold → throttle withdrawals. */
export async function evaluateCB5(threshold: number, windowMs = 3_600_000): Promise<BreakerEvent> {
  const since = new Date(Date.now() - windowMs);
  const count = await WithdrawalModel.countDocuments({ createdAt: { $gte: since } });
  if (count > threshold) {
    return trip('CB5', 'Platform withdrawal rate', 'enable_withdrawal_throttle', { count, threshold });
  }
  return ok('CB5', 'Platform withdrawal rate');
}

/** CB6 — a fund flow on a non-whitelisted clearing path. Also enforced inline in transfer(). */
export async function evaluateCB6(
  fromType: AccountType,
  toType: AccountType,
): Promise<BreakerEvent> {
  if (!isFlowAllowed(fromType, toType)) {
    return trip('CB6', 'Non-whitelist fund flow', 'reject', { fromType, toType });
  }
  return ok('CB6', 'Non-whitelist fund flow');
}

/** The HD-derivation branch index each account type's on-chain address must live under (spec §3.4). */
const EXPECTED_BRANCH: Readonly<Partial<Record<AccountType, number>>> = {
  [AccountType.TREASURY]: 0,
  [AccountType.INSURANCE]: 1,
  [AccountType.REINSURANCE]: 2,
  [AccountType.LEAGUE_INVENTORY]: 3,
  [AccountType.JACKPOT_MINI]: 4,
  [AccountType.JACKPOT_MINOR]: 4,
  [AccountType.JACKPOT_MAJOR]: 4,
  [AccountType.JACKPOT_GRAND]: 4,
  [AccountType.PLAYER]: 5,
};

/** CB7 — an on-chain address whose derivation path does not match its account type → abort + review. */
export async function evaluateCB7(
  accountType: AccountType,
  derivationPath: string,
): Promise<BreakerEvent> {
  const expected = EXPECTED_BRANCH[accountType];
  // Path shape: m/44'/195'/0'/<branch>/...  — the 5th segment is the branch index.
  const branch = Number(derivationPath.split('/')[4]);
  if (expected === undefined || Number.isNaN(branch) || branch !== expected) {
    return trip('CB7', 'On-chain address mapping', 'abort_and_review', {
      accountType,
      derivationPath,
      expectedBranch: expected ?? null,
    });
  }
  return ok('CB7', 'On-chain address mapping');
}
