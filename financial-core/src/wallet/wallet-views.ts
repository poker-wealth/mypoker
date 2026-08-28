import { Money } from '../domain/money';
import { LedgerModel } from './ledger.model';
import { WithdrawalModel } from '../withdrawal/withdrawal.model';
// The enum, not string literals: 'BROADCAST' silently matched nothing.
import { WithdrawalState } from '../domain/withdrawal-types';
import { PendingDepositModel } from '../deposit/pending-deposit.model';

/**
 * Read-only wallet views for the player's own screen.
 *
 * Both read the canonical records (the ledger, the withdrawal audit trail) and
 * write nothing. `/me/history` is deliberately game hands only (see
 * stats/player-stats.ts), so the wallet's money movements — deposits,
 * withdrawals, bets, wins — need this ledger-shaped view instead.
 */

export interface WalletTxn {
  at: string;
  type: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  businessId: string | null;
  /**
   * Lifecycle state, present ONLY for a withdrawal that has not settled yet.
   * Absent means the row is a settled ledger entry and needs no qualifier.
   */
  state?: string;
}

/**
 * In-flight withdrawal states — the ones with no ledger entry yet.
 *
 * CONFIRMED is excluded because confirmWithdrawal() writes the real ledger legs,
 * so including it here would show the same withdrawal twice. REJECTED is
 * excluded because no money ever moved: it belongs in the withdrawals list,
 * not in a record of what happened to the balance.
 */
const IN_FLIGHT = [
  WithdrawalState.REQUESTED,
  WithdrawalState.APPROVED,
  WithdrawalState.BROADCASTING,
];

/**
 * The player's money movements, newest first. Scoped to their own account only.
 *
 * Ledger entries PLUS in-flight withdrawals. A withdrawal writes no ledger row
 * until confirmWithdrawal() — request and approve move availableBalance into
 * clearingBalance as account fields — so a payout the player had asked for was
 * invisible on this screen for its entire lifetime, and only appeared once it
 * had already completed. Someone watching for their money saw nothing at all
 * happening.
 *
 * They are merged here, in the view, rather than by writing speculative ledger
 * rows. The ledger records money that has moved; a requested withdrawal has not
 * moved any, and inventing an entry for it would put a claim in the permanent
 * record that the money path never made.
 */
export async function getWalletTransactions(
  accountId: string,
  opts: { limit?: number } = {},
): Promise<{ transactions: WalletTxn[] }> {
  const limit = Math.min(opts.limit ?? 50, 200);

  const [rows, inFlight, incoming] = await Promise.all([
    LedgerModel.find({ accountId }).sort({ createdAt: -1 }).limit(limit).lean(),
    WithdrawalModel.find({ playerAccountId: accountId, state: { $in: IN_FLIGHT } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    // Unconfirmed deposits — sightings, not ledger entries. See
    // deposit/pending-deposit.model.ts for why they are kept apart.
    PendingDepositModel.find({ playerAccountId: accountId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  const settled: WalletTxn[] = rows.map((r) => ({
    at: r.createdAt.toISOString(),
    type: r.type,
    direction: r.direction,
    amount: Money.fromDecimal128(r.amount).toString(),
    businessId: r.businessId ?? null,
  }));

  const pending: WalletTxn[] = inFlight.map((w) => ({
    at: w.createdAt.toISOString(),
    type: 'WITHDRAW',
    // Money on its way out, even while it is only reserved.
    direction: 'DEBIT',
    amount: Money.fromDecimal128(w.amount).toString(),
    // The same id the withdrawal notification's event id carries, so tapping
    // that notification resolves to this row.
    businessId: w._id,
    state: w.state,
  }));

  const arriving: WalletTxn[] = incoming.map((p) => ({
    at: p.createdAt.toISOString(),
    type: 'DEPOSIT',
    direction: 'CREDIT',
    amount: Money.fromDecimal128(p.amount).toString(),
    businessId: p._id,
    // The client MUST render this as not-yet-arrived. The amount is real but it
    // is not in any balance, and will not be until the chain confirms it.
    state: 'PENDING',
  }));

  // Merged then trimmed, so the newest `limit` across ALL sources wins rather
  // than the newest limit of each.
  const transactions = [...settled, ...pending, ...arriving]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);

  return { transactions };
}

export interface WithdrawalSummary {
  id: string;
  amount: string;
  address: string;
  state: string;
  txHash: string | null;
  at: string;
}

/** The player's withdrawals with their current lifecycle state, newest first. */
export async function getWithdrawals(
  playerAccountId: string,
  opts: { limit?: number } = {},
): Promise<{ withdrawals: WithdrawalSummary[] }> {
  const rows = await WithdrawalModel.find({ playerAccountId })
    .sort({ createdAt: -1 })
    .limit(Math.min(opts.limit ?? 50, 200))
    .lean();
  return {
    withdrawals: rows.map((w) => ({
      id: w._id,
      amount: Money.fromDecimal128(w.amount).toString(),
      address: w.address,
      state: w.state,
      txHash: w.txHash ?? null,
      at: w.createdAt.toISOString(),
    })),
  };
}
