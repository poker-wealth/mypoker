import { Money } from '../domain/money';
import { LedgerModel } from './ledger.model';
import { WithdrawalModel } from '../withdrawal/withdrawal.model';

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
}

/** The player's ledger entries, newest first. Scoped to their own account only. */
export async function getWalletTransactions(
  accountId: string,
  opts: { limit?: number } = {},
): Promise<{ transactions: WalletTxn[] }> {
  const rows = await LedgerModel.find({ accountId })
    .sort({ createdAt: -1 })
    .limit(Math.min(opts.limit ?? 50, 200))
    .lean();
  return {
    transactions: rows.map((r) => ({
      at: r.createdAt.toISOString(),
      type: r.type,
      direction: r.direction,
      amount: Money.fromDecimal128(r.amount).toString(),
      businessId: r.businessId ?? null,
    })),
  };
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
