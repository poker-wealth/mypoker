import { api } from './client';

/**
 * Wallet: balance, deposit address, withdrawals, and money-movement history.
 *
 * financial-core owns every figure here — the frontend only displays what the
 * gateway forwards and submits a withdrawal REQUEST (never a balance change).
 * Amounts are decimal strings end to end; they are never parsed into a float and
 * summed on the client.
 */

export interface Balance {
  /** Spendable. */
  available: string;
  /** Committed to a live table buy-in — not spendable, not withdrawable. */
  locked: string;
  /** In-flight on a withdrawal. */
  clearing: string;
  /** available + locked + clearing, summed exactly server-side. */
  total: string;
}

export interface DepositAddress {
  configured: boolean;
  /** Present only when configured. */
  address?: string;
  network?: 'TRC20';
  /** The one USDT contract the platform credits from. */
  contract?: string;
}

export interface WalletTxn {
  at: string;
  type: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  businessId: string | null;
}

export type WithdrawalState =
  | 'REQUESTED'
  | 'APPROVED'
  | 'BROADCAST'
  | 'CONFIRMED'
  | 'REJECTED';

export interface Withdrawal {
  id: string;
  amount: string;
  address: string;
  state: WithdrawalState;
  txHash: string | null;
  at: string;
}

export const fetchBalance = (): Promise<Balance> => api.get<Balance>('/me/balance');

export const fetchDepositAddress = (): Promise<DepositAddress> =>
  api.get<DepositAddress>('/me/deposit-address');

export const fetchTransactions = (limit = 50): Promise<{ transactions: WalletTxn[] }> =>
  api.get<{ transactions: WalletTxn[] }>(`/me/transactions?limit=${limit}`);

export const fetchWithdrawals = (limit = 50): Promise<{ withdrawals: Withdrawal[] }> =>
  api.get<{ withdrawals: Withdrawal[] }>(`/me/withdrawals?limit=${limit}`);

export interface WithdrawRequest {
  /** Decimal string, e.g. '200.000000'. */
  amount: string;
  /** Destination TRON (TRC-20) address. */
  address: string;
}

export const requestWithdrawal = (
  body: WithdrawRequest,
): Promise<{ withdrawalId: string; state: WithdrawalState }> =>
  api.post<{ withdrawalId: string; state: WithdrawalState }>('/me/withdrawals', body);
