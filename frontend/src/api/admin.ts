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
  /**
   * null means no account exists — a different fact from a zero balance.
   * Unless balancesUnavailable is set, in which case null means only that
   * financial-core could not be asked.
   */
  balance: string | null;
}

export interface PlayerSearchResult {
  players: PlayerSearchRow[];
  truncated: boolean;
  /**
   * financial-core did not answer, so every balance in this response is null
   * for that reason — render "unavailable", never "no account".
   */
  balancesUnavailable?: boolean;
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

/**
 * One account as the edit form sees it.
 *
 * `hasPassword` and `hasGoogle` rather than the credentials themselves — the
 * form needs to know whether there is a password to replace, never what it is.
 *
 * `emailVerified` is `boolean | null`, and the null matters: an account created
 * before confirmation existed has never been asked the question, which is not
 * the same as having failed to confirm. Rendering that third state as "no" would
 * invite an admin to "fix" something that was never broken.
 */
export interface AdminUserRecord {
  playerId: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  photoUrl: string | null;
  emailVerified: boolean | null;
  role: 'player' | 'league_admin' | 'ops';
  hasPassword: boolean;
  hasGoogle: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  suspendedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Absent = leave alone, null = clear, value = set. The server reads it the same way. */
export interface AdminUserPatch {
  displayName?: string;
  email?: string | null;
  phone?: string | null;
  emailVerified?: boolean;
  role?: 'player' | 'league_admin' | 'ops';
  reason?: string;
}

export interface AdminAuditEntry {
  id: string;
  actorPlayerId: string;
  subjectPlayerId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  at: string;
}

export const fetchUserRecord = (playerId: string): Promise<AdminUserRecord> =>
  api.get<AdminUserRecord>(`/admin/players/${encodeURIComponent(playerId)}/account`);

export const fetchUserAudit = (playerId: string): Promise<{ entries: AdminAuditEntry[] }> =>
  api.get<{ entries: AdminAuditEntry[] }>(`/admin/players/${encodeURIComponent(playerId)}/audit`);

export const updateUser = (playerId: string, patch: AdminUserPatch): Promise<AdminUserRecord> =>
  api.patch<AdminUserRecord>(`/admin/players/${encodeURIComponent(playerId)}`, patch);

export const setUserSuspension = (
  playerId: string,
  suspended: boolean,
  reason?: string,
): Promise<AdminUserRecord> =>
  api.post<AdminUserRecord>(`/admin/players/${encodeURIComponent(playerId)}/suspension`, {
    suspended,
    ...(reason ? { reason } : {}),
  });

export const setUserPassword = (
  playerId: string,
  newPassword: string,
  reason?: string,
): Promise<{ ok: true }> =>
  api.post<{ ok: true }>(`/admin/players/${encodeURIComponent(playerId)}/password`, {
    newPassword,
    ...(reason ? { reason } : {}),
  });

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

export type LeagueFundingKind = 'TOPUP' | 'CASHOUT';
export type LeagueFundingState = 'REQUESTED' | 'APPROVED' | 'EXECUTED' | 'REJECTED';

export interface LeagueFundingRequest {
  _id: string;
  leagueId: string;
  kind: LeagueFundingKind;
  amount: string;
  state: LeagueFundingState;
  requestedBy: string;
  approvals: string[];
  address?: string;
  createdAt: string;
}

export interface FundingApproval {
  applied: boolean;
  approvals: string[];
  awaitingSecondApproval?: true;
}

export const fetchLeagueFunding = (): Promise<{ requests: LeagueFundingRequest[] }> =>
  api.get<{ requests: LeagueFundingRequest[] }>('/admin/league-funding');

export const requestTopUp = (body: { leagueId: string; amount: string }): Promise<{ requestId: string }> =>
  api.post<{ requestId: string }>('/admin/league-funding/top-ups', body);

export const requestCashOut = (body: {
  leagueId: string;
  amount: string;
  address: string;
}): Promise<{ requestId: string }> =>
  api.post<{ requestId: string }>('/admin/league-funding/cash-outs', body);

export const approveFunding = (id: string): Promise<FundingApproval> =>
  api.post<FundingApproval>(`/admin/league-funding/${encodeURIComponent(id)}/approve`, {});

export const rejectFunding = (id: string, reason: string): Promise<{ ok: true }> =>
  api.post<{ ok: true }>(`/admin/league-funding/${encodeURIComponent(id)}/reject`, { reason });

export const executeFunding = (id: string): Promise<{ applied: boolean }> =>
  api.post<{ applied: boolean }>(`/admin/league-funding/${encodeURIComponent(id)}/execute`, {});

export interface QueuedWithdrawal {
  withdrawalId: string;
  playerId: string;
  amount: string;
  address: string;
  state: 'REQUESTED' | 'APPROVED';
  /** Ops who have already approved, by name — the rule is a second person. */
  approvals: string[];
  vipTier: string;
  vipTitle: string;
  requestedAt: string;
}

export const fetchWithdrawalQueue = (): Promise<{ withdrawals: QueuedWithdrawal[] }> =>
  api.get<{ withdrawals: QueuedWithdrawal[] }>('/admin/withdrawals');

/**
 * What financial-core answers when an approval is recorded.
 *
 * `approvals` is a COUNT of distinct approvers so far and `required` is how many
 * this amount needs (2 above the dual-confirm threshold, 1 below) — so the UI
 * can say "1 of 2" without knowing the threshold itself. Funds move only when
 * approvals reaches required; until then the withdrawal stays REQUESTED.
 */
export interface WithdrawalApproval {
  state: string;
  approvals: number;
  required: number;
}

export const approveWithdrawal = (id: string): Promise<WithdrawalApproval> =>
  api.post<WithdrawalApproval>(`/admin/withdrawals/${encodeURIComponent(id)}/approve`, {});

export const rejectWithdrawal = (id: string, reason: string): Promise<{ state: string }> =>
  api.post<{ state: string }>(`/admin/withdrawals/${encodeURIComponent(id)}/reject`, { reason });
