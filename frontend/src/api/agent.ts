import { api } from './client';

/**
 * Agent Center. Mirrors financial-core/src/agent/agent-store.ts.
 *
 * Note the absence of any balance field on ReferredPlayer. That is the iron
 * rule — an agent gets referral tracking and read-only performance data, never
 * what a player holds — and it is enforced server-side, not by this type.
 */

export interface AgentSummary {
  agentId: string;
  /** Null for a top-level agent, set for a sub-agent — §13.4's tier badge. */
  parentAgentId: string | null;
  rateBps: number;
  status: 'ACTIVE' | 'SUSPENDED';
  totalCommission: number;
  playerCount: number;
  subAgentCount: number;
}

/** The four periods §13.4 offers. The server decides what each one covers. */
export type AgentRange = 'today' | 'week' | '30d' | 'all';

export type ActivityStatus = 'ACTIVE' | 'DORMANT' | 'CHURNED';

export interface ReferredPlayer {
  playerId: string;
  commissionGenerated: number;
  rounds: number;
  boundAt: string;
  lastActiveAt: string | null;
  linkId: string;
  /** Set when this player sits under a sub-agent rather than directly. */
  viaAgentId: string | null;
  todayVolume: number;
  monthVolume: number;
  todayCommission: number;
  monthCommission: number;
  lifetimeEffective: number;
  /** Derived by the gateway from the same ladder the VIP page uses. */
  vipTier: 'V1' | 'V2' | 'V3' | 'V4' | 'V5';
  vipTitle: string;
  activity: ActivityStatus;
}

/** Tab 1's three rows. */
export interface CommissionBreakdown {
  total: number;
  direct: number;
  override: number;
}

export interface SettlementRecord {
  recordId: string;
  at: string;
  playerId: string;
  viaAgentId: string | null;
  kind: 'DIRECT' | 'OVERRIDE';
  gameId: string;
  roundId: string;
  rakeAmount: number;
  amount: number;
}

export interface ReferralLink {
  linkId: string;
  label: string;
  registrations: number;
}

export interface SubAgent {
  agentId: string;
  parentAgentId: string | null;
  rateBps: number;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
}

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
  reputation: number;
  required: number;
  alreadyAgent: boolean;
}

/** `agent` is null for an ordinary player — not an error. */
export const fetchAgent = (): Promise<{ agent: AgentSummary | null }> =>
  api.get<{ agent: AgentSummary | null }>('/agent');

export const fetchAgentEligibility = (): Promise<Eligibility> =>
  api.get<Eligibility>('/agent/eligibility');

export const fetchAgentPlayers = (): Promise<{ players: ReferredPlayer[] }> =>
  api.get<{ players: ReferredPlayer[] }>('/agent/players');

export const fetchAgentLinks = (): Promise<{ links: ReferralLink[] }> =>
  api.get<{ links: ReferralLink[] }>('/agent/links');

export const fetchSubAgents = (): Promise<{ subAgents: SubAgent[] }> =>
  api.get<{ subAgents: SubAgent[] }>('/agent/sub-agents');

export const createReferralLinkApi = (body: { label?: string }): Promise<ReferralLink> =>
  api.post<ReferralLink>('/agent/links', body);

export const fetchCommissionBreakdown = (range: AgentRange): Promise<CommissionBreakdown> =>
  api.get<CommissionBreakdown>(`/agent/breakdown?range=${range}`);

export const fetchCommissionSeries = (
  range: AgentRange,
): Promise<{ points: { date: string; amount: number }[] }> =>
  api.get<{ points: { date: string; amount: number }[] }>(`/agent/series?range=${range}`);

export const fetchSettlements = (
  range: AgentRange,
  source?: 'DIRECT' | 'OVERRIDE',
): Promise<{ records: SettlementRecord[]; truncated: boolean }> =>
  api.get<{ records: SettlementRecord[]; truncated: boolean }>(
    `/agent/settlements?range=${range}${source ? `&source=${source}` : ''}`,
  );

/** §13.1 — B's rate is set and owned by A. Bounds are enforced server-side. */
export const setSubAgentRateApi = (subAgentId: string, rateBps: number): Promise<{ ok: true }> =>
  api.patch<{ ok: true }>(`/agent/sub-agents/${encodeURIComponent(subAgentId)}`, { rateBps });
