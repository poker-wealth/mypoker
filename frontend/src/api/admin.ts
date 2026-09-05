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
  /** Present since reputation and VIP became overridable. */
  override?: PlayerOverride;
}

export const searchPlayers = (q: string): Promise<PlayerSearchResult> =>
  api.get<PlayerSearchResult>(`/admin/players?q=${encodeURIComponent(q)}`);

/**
 * One row of the full Users list, which is the UNION of two populations:
 * financial-core's players (everyone money has touched, including Telegram
 * players with no identity document) and the gateway's registrations (including
 * accounts that have never deposited or played).
 *
 * `balance` is therefore NULLABLE — it was `string` when the list came from
 * financial-core alone. Null means no financial account exists yet, which the
 * table already renders as "no account" rather than as zero. Those are
 * different facts and an admin acts differently on each.
 */
export interface AdminUserRow {
  playerId: string;
  displayName: string | null;
  email: string | null;
  balance: string | null;
  available: string | null;
  joinedAt: string;
}

export const fetchUsers = (limit?: number): Promise<{ users: AdminUserRow[]; truncated: boolean }> =>
  api.get<{ users: AdminUserRow[]; truncated: boolean }>(
    `/admin/users${limit ? `?limit=${limit}` : ''}`,
  );

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
  /**
   * The document stores `'ops'` or nothing; the server reports the absent case
   * as `'player'`. `league_admin` exists in the token type but nothing grants or
   * reads it, so it is deliberately not offered here — a role that confers
   * nothing is a control an admin would reasonably expect to do something.
   */
  role: 'player' | 'ops';
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
  role?: 'player' | 'ops';
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

/**
 * An administrator override of a DERIVED value.
 *
 * Both the override and the computed value are carried, because the form has to
 * show what the player would have had as well as what was decided instead — an
 * override that renders as an ordinary number is indistinguishable from an
 * earned one, and nobody could tell a granted tier from a played-for tier.
 */
export interface PlayerOverride {
  reputationScore: number | null;
  vipTier: string | null;
  computedScore: number;
  computedTier: string;
  setBy: string | null;
  reason: string | null;
  at: string | null;
}

export const setPlayerOverride = (
  playerId: string,
  patch: { reputationScore?: number | null; vipTier?: string | null; reason: string },
): Promise<unknown> =>
  api.post(`/admin/players/${encodeURIComponent(playerId)}/override`, patch);

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

export interface LeagueMemberDetail {
  playerId: string;
  role: string;
  joinedAt: string;
  displayName: string | null;
  email: string | null;
}

/** One league in full — for the admin drill-into-a-club view. */
export interface LeagueDetail {
  leagueId: string;
  name: string;
  ownerId: string;
  memberCount: number;
  inviteOnly: boolean;
  inventory: string;
  rake: string;
  insurance: string;
  createdAt: string;
  description: string | null;
  settings: { rakeBps: number; tableHours: number; buyIn: number; spectatorsAllowed: boolean } | null;
  pendingRakeChange: { rakeBps: number; effectiveAt: string } | null;
  owner: { playerId: string; displayName: string | null; email: string | null };
  members: LeagueMemberDetail[];
}

export const fetchLeagueDetail = (leagueId: string): Promise<LeagueDetail> =>
  api.get<LeagueDetail>(`/admin/leagues/${encodeURIComponent(leagueId)}`);

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

/**
 * Take an APPROVED withdrawal on-chain: sign + broadcast the USDT transfer from
 * the hot wallet, moving it to BROADCASTING with a real tx hash. On any failure
 * the withdrawal rolls back (the clearing hold is released), so a failed send
 * never strands the player's money.
 */
export const sendWithdrawal = (id: string): Promise<{ state: string; txHash: string }> =>
  api.post<{ state: string; txHash: string }>(
    `/admin/withdrawals/${encodeURIComponent(id)}/send`,
    {},
  );

// ── Admins ───────────────────────────────────────────────────────────────────

/** A platform administrator, as the Admins screen lists them. */
export interface AdminAccount {
  playerId: string;
  email?: string;
  displayName?: string;
  createdAt: string;
}

export const fetchAdmins = (): Promise<{ admins: AdminAccount[] }> =>
  api.get<{ admins: AdminAccount[] }>('/admin/admins');

export const createAdmin = (body: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ admin: AdminAccount }> =>
  api.post<{ admin: AdminAccount }>('/admin/admins', body);
