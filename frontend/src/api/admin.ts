import { api } from './client';

/**
 * The admin API. Mirrors game-server/src/gateway/admin-routes.ts.
 *
 * Everything here is behind `requireAdmin` server-side. Nothing in this file is
 * a permission check — the client cannot grant itself anything, and a
 * non-admin calling these gets a 404 that is indistinguishable from the route
 * not existing.
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
  /** Whether this breaker is actually enforcing anything yet. */
  status: 'live' | 'planned';
  tripsToday: number;
  lastTripAt: string | null;
}

export interface OpsOverview {
  at: string;
  balances: BalanceByType[];
  /** What the platform owes players: available + locked + clearing. */
  playerFunds: string;
  withdrawals: {
    pending: number;
    awaitingSecondApproval: number;
    inFlight: number;
  };
  today: {
    deposits: { count: number; total: string };
    withdrawals: { count: number; total: string };
  };
  breakers: BreakerStatus[];
}

export const fetchOpsOverview = (): Promise<OpsOverview> =>
  api.get<OpsOverview>('/admin/overview');
