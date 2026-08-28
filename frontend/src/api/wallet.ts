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
  /**
   * Lifecycle state, sent ONLY for a withdrawal that has not settled yet — it
   * has no ledger entry until it confirms. Absent means the row is settled.
   */
  state?: WithdrawalState;
}

/**
 * Mirrors financial-core's WithdrawalState enum EXACTLY.
 *
 * It previously said `BROADCAST` and `REJECTED`; the service emits
 * `BROADCASTING` and `ROLLED_BACK`. Nothing caught it because the only consumer
 * rendered the string raw, so the wrong names merely displayed oddly — until
 * something tried to look a state up in a map and got undefined.
 *
 * ROLLED_BACK is not only an ops refusal: a failed broadcast rolls back too. It
 * means "the hold was released and the money is back in your balance", which is
 * why the label for it is neutral rather than an accusation.
 */
export type WithdrawalState =
  | 'REQUESTED'
  | 'APPROVED'
  | 'BROADCASTING'
  | 'CONFIRMED'
  | 'ROLLED_BACK';

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

/**
 * The player's REGISTERED withdrawal address (§3.6).
 *
 * Withdrawals may only go to this address, and changing it starts a 48h
 * cooldown before the new one may be used — so a stolen session cannot
 * immediately redirect funds to an attacker. `withdrawableAt` is when the
 * current address becomes usable; until then financial-core refuses.
 */
export interface WithdrawalAddress {
  configured: boolean;
  address?: string;
  updatedAt?: string;
  /** ISO timestamp — withdrawals to this address open at this moment. */
  withdrawableAt?: string;
}

export const fetchWithdrawalAddress = (): Promise<WithdrawalAddress> =>
  api.get<WithdrawalAddress>('/me/withdrawal-address');

export const saveWithdrawalAddress = (address: string): Promise<WithdrawalAddress> =>
  api.post<WithdrawalAddress>('/me/withdrawal-address', { address });
