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
  rateBps: number;
  status: 'ACTIVE' | 'SUSPENDED';
  totalCommission: number;
  playerCount: number;
  subAgentCount: number;
}

export interface ReferredPlayer {
  playerId: string;
  commissionGenerated: number;
  rounds: number;
  boundAt: string;
  lastActiveAt: string | null;
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
