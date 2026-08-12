import { Money } from '../domain/money';
import { AccountType, LedgerType, LedgerDirection } from '../domain/account-types';
import { WithdrawalState } from '../domain/withdrawal-types';
import { AccountModel } from '../wallet/account.model';
import { LedgerModel } from '../wallet/ledger.model';
import { WithdrawalModel } from '../withdrawal/withdrawal.model';
import { SecurityLogModel } from '../security/security-log.model';
import { CIRCUIT_BREAKERS } from '../circuit-breakers/registry';

/**
 * The admin Overview's facts (SAMUEL.md task 3, screen 1).
 *
 * Facts only — sums, counts, and what the security log recorded. No judgment
 * about whether a number is healthy: thresholds live with the rules that own
 * them (the underwriting engine, the breakers), and a second opinion computed
 * here would drift from the first.
 *
 * Every figure is a decimal string, summed with Money. An operator's overview
 * is the screen most likely to be read as authoritative and least likely to be
 * reconciled against anything, so a float rounding here would be believed.
 */

export interface BalanceByType {
  accountType: string;
  /** Decimal string, USD. */
  total: string;
  accounts: number;
}

export interface BreakerStatus {
  id: string;
  name: string;
  /** From the registry: whether this breaker is enforcing anything yet. */
  status: 'live' | 'planned';
  /** Times it tripped in the last 24h, from the security log. */
  tripsToday: number;
  lastTripAt: string | null;
}

export interface OpsOverview {
  at: string;
  balances: BalanceByType[];
  /**
   * What the platform owes players — the sum of every PLAYER account's three
   * balances. The single number an operator most needs, and the one no other
   * screen shows.
   */
  playerFunds: string;
  withdrawals: {
    /** REQUESTED — waiting for a reviewer. */
    pending: number;
    /** REQUESTED and already carrying one signature (large ones, §3.6). */
    awaitingSecondApproval: number;
    /** APPROVED or BROADCASTING — money held, not yet gone. */
    inFlight: number;
  };
  today: {
    deposits: { count: number; total: string };
    withdrawals: { count: number; total: string };
  };
  breakers: BreakerStatus[];
}

/** Start of the current UTC day. Same boundary the insurance reserve uses. */
function startOfUtcDay(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function getOpsOverview(now = new Date()): Promise<OpsOverview> {
  const dayStart = startOfUtcDay(now);

  const [accounts, withdrawalCounts, awaitingSecond, depositRows, withdrawalRows, trips] =
    await Promise.all([
      AccountModel.find({}, { accountType: 1, availableBalance: 1, lockedBalance: 1, clearingBalance: 1 }).lean(),
      WithdrawalModel.aggregate<{ _id: string; n: number }>([
        { $group: { _id: '$state', n: { $sum: 1 } } },
      ]),
      // One signature so far on something that needs two. `approvals` may be
      // absent on rows written before the field existed, hence the size check
      // rather than a truthiness test.
      WithdrawalModel.countDocuments({
        state: WithdrawalState.REQUESTED,
        approvals: { $size: 1 },
      }),
      LedgerModel.find({
        type: LedgerType.DEPOSIT,
        direction: LedgerDirection.CREDIT,
        createdAt: { $gte: dayStart },
      }).lean(),
      LedgerModel.find({
        type: LedgerType.WITHDRAW,
        direction: LedgerDirection.DEBIT,
        createdAt: { $gte: dayStart },
      }).lean(),
      SecurityLogModel.find({
        event: { $regex: '^CIRCUIT_BREAKER_' },
        createdAt: { $gte: new Date(now.getTime() - 86_400_000) },
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

  // Balances by type, summed exactly. A player's holding is all three balances:
  // available plus what is locked at a table plus what is held mid-withdrawal.
  // Reporting only `available` would understate what the platform owes by
  // exactly the amount currently in play.
  const byType = new Map<string, { total: Money; accounts: number }>();
  for (const a of accounts) {
    const held = Money.fromDecimal128(a.availableBalance)
      .add(Money.fromDecimal128(a.lockedBalance))
      .add(Money.fromDecimal128(a.clearingBalance));
    const entry = byType.get(a.accountType) ?? { total: Money.ZERO, accounts: 0 };
    byType.set(a.accountType, { total: entry.total.add(held), accounts: entry.accounts + 1 });
  }

  const counts = new Map(withdrawalCounts.map((r) => [r._id, r.n]));
  const tripsByBreaker = new Map<string, { n: number; last: Date }>();
  for (const t of trips) {
    const id = t.event.replace('CIRCUIT_BREAKER_', '');
    const seen = tripsByBreaker.get(id);
    // Sorted newest-first, so the first one seen is the latest.
    if (seen) seen.n += 1;
    else tripsByBreaker.set(id, { n: 1, last: t.createdAt });
  }

  return {
    at: now.toISOString(),
    balances: [...byType.entries()]
      .map(([accountType, v]) => ({
        accountType,
        total: v.total.toString(),
        accounts: v.accounts,
      }))
      .sort((a, b) => a.accountType.localeCompare(b.accountType)),
    playerFunds: (byType.get(AccountType.PLAYER)?.total ?? Money.ZERO).toString(),
    withdrawals: {
      pending: counts.get(WithdrawalState.REQUESTED) ?? 0,
      awaitingSecondApproval: awaitingSecond,
      inFlight:
        (counts.get(WithdrawalState.APPROVED) ?? 0) +
        (counts.get(WithdrawalState.BROADCASTING) ?? 0),
    },
    today: {
      deposits: {
        count: depositRows.length,
        total: Money.sum(depositRows.map((r) => Money.fromDecimal128(r.amount))).toString(),
      },
      withdrawals: {
        count: withdrawalRows.length,
        total: Money.sum(withdrawalRows.map((r) => Money.fromDecimal128(r.amount))).toString(),
      },
    },
    // The registry order is the spec's order (CB1..CB7); keep it, so an
    // operator learning the list learns it in one arrangement.
    breakers: CIRCUIT_BREAKERS.map((cb) => {
      const t = tripsByBreaker.get(cb.id);
      return {
        id: cb.id,
        name: cb.name,
        status: cb.status,
        tripsToday: t?.n ?? 0,
        lastTripAt: t ? t.last.toISOString() : null,
      };
    }),
  };
}
