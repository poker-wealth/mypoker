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

export interface TableJackpot {
  tableId: string;
  mini: string;
  minor: string;
  major: string;
  grand: string;
  total: string;
}

export interface OpsOverview {
  at: string;
  balances: BalanceByType[];
  volume: { allTime: string; today: string };
  rake: { allTime: string; today: string };
  activePlayers: { today: number; last7Days: number };
  jackpotByTable: TableJackpot[];
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

export interface PlayerSearchRow {
  playerId: string;
  displayName: string | null;
  email: string | null;
  /** null means no account exists — a different fact from a zero balance. */
  balance: string | null;
}

export interface PlayerSearchResult {
  players: PlayerSearchRow[];
  truncated: boolean;
  /** Set when the result needs explaining rather than just listing. */
  note?: string;
}

export interface AdminPlayerDetail {
  playerId: string;
  hasAccount: boolean;
  balances: { available: string; locked: string; clearing: string; total: string };
  reputation: {
    roundsPlayed: number;
    findings: string[];
    score: number;
    band: string;
  };
  vip: { tier: string; title: string };
  volume: { cumulativeEffective: number; monthlyEffective: number };
  identity: { displayName: string | null; email: string | null; createdAt: string | null } | null;
}

export const searchPlayers = (q: string): Promise<PlayerSearchResult> =>
  api.get<PlayerSearchResult>(`/admin/players?q=${encodeURIComponent(q)}`);

export const fetchPlayerDetail = (playerId: string): Promise<AdminPlayerDetail> =>
  api.get<AdminPlayerDetail>(`/admin/players/${encodeURIComponent(playerId)}`);

export interface AdminAlert {
  id: string;
  at: string;
  event: string;
  detail: Record<string, unknown>;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  /** A human label, derived server-side so every channel uses one wording. */
  label: string;
}

export interface AdminAlerts {
  events: AdminAlert[];
  breakers: BreakerStatus[];
}

export const fetchAdminAlerts = (): Promise<AdminAlerts> =>
  api.get<AdminAlerts>('/admin/alerts');

export interface LeagueOverviewRow {
  leagueId: string;
  name: string;
  ownerId: string;
  memberCount: number;
  inviteOnly: boolean;
  inventory: string;
  rake: string;
  insurance: string;
  createdAt: string;
}

export const fetchAdminLeagues = (): Promise<{ leagues: LeagueOverviewRow[] }> =>
  api.get<{ leagues: LeagueOverviewRow[] }>('/admin/leagues');
