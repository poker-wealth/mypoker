import { assertValidSubAgentRate, CommissionRuleError } from './commission';

/**
 * The agent tree and who is allowed to be in it (FairPlay v5.9 §13, §13.3).
 *
 * Exactly two levels: Platform → Agent A → Sub-Agent B. B is TERMINAL — it cannot recruit, which is
 * what stops this becoming a pyramid with infinite downline. B's rate is set and owned by A; B can
 * neither see nor change it.
 *
 * Eligibility (§13.3) reuses the standing systems built for anti-bot: reputation ≥ 700, no confirmed
 * collusion, no high-risk bot flag. All three, or the application is rejected.
 */

export const MIN_REPUTATION_FOR_AGENT = 700;

export interface AgentApplication {
  playerId: string;
  reputationScore: number;
  hasConfirmedCollusion: boolean;
  antiBotHighRisk: boolean;
}

export type ApplicationOutcome =
  | { approved: true }
  | { approved: false; reasons: string[] };

/** Ops runs this before approving an agent. Any one failure rejects, with the reason stated. */
export function reviewApplication(app: AgentApplication): ApplicationOutcome {
  const reasons: string[] = [];
  if (app.reputationScore < MIN_REPUTATION_FOR_AGENT) {
    reasons.push(`reputation ${app.reputationScore} is below ${MIN_REPUTATION_FOR_AGENT}`);
  }
  if (app.hasConfirmedCollusion) reasons.push('confirmed collusion record');
  if (app.antiBotHighRisk) reasons.push('anti-bot high-risk flag');
  return reasons.length === 0 ? { approved: true } : { approved: false, reasons };
}

export interface Agent {
  agentId: string;
  /** Set for a sub-agent: the agent who recruited and owns them. */
  parentAgentId?: string;
  /** A sub-agent's commission rate, owned by the parent. Undefined for a top-level agent. */
  rateBps?: number;
  referralCode: string;
}

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();
  /** playerId → the agent whose referral link they signed up through. */
  private readonly referredBy = new Map<string, string>();

  /** Register a top-level agent (30% base rate — not settable per-agent). */
  addAgent(agentId: string, referralCode: string): Agent {
    if (this.agents.has(agentId)) throw new CommissionRuleError(`agent exists: ${agentId}`);
    const agent: Agent = { agentId, referralCode };
    this.agents.set(agentId, agent);
    return agent;
  }

  /**
   * A recruits sub-agent B at a rate A chooses. Rejected if B would be a third level — the two-level
   * cap is what keeps this a referral scheme rather than a pyramid.
   */
  addSubAgent(parentAgentId: string, agentId: string, rateBps: number, referralCode: string): Agent {
    const parent = this.agents.get(parentAgentId);
    if (!parent) throw new CommissionRuleError(`unknown agent: ${parentAgentId}`);
    if (parent.parentAgentId) {
      throw new CommissionRuleError('a sub-agent cannot recruit sub-agents (2 levels maximum)');
    }
    if (this.agents.has(agentId)) throw new CommissionRuleError(`agent exists: ${agentId}`);
    assertValidSubAgentRate(rateBps);

    const agent: Agent = { agentId, parentAgentId, rateBps, referralCode };
    this.agents.set(agentId, agent);
    return agent;
  }

  /** A may change B's rate at any time; the range rules still apply. B has no say. */
  setSubAgentRate(parentAgentId: string, subAgentId: string, rateBps: number): void {
    const sub = this.agents.get(subAgentId);
    if (!sub || sub.parentAgentId !== parentAgentId) {
      throw new CommissionRuleError('only the parent agent may set this rate');
    }
    assertValidSubAgentRate(rateBps);
    sub.rateBps = rateBps;
  }

  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  linkPlayer(playerId: string, agentId: string): void {
    if (!this.agents.has(agentId)) throw new CommissionRuleError(`unknown agent: ${agentId}`);
    this.referredBy.set(playerId, agentId);
  }

  /** Who earns on this player's rake: the referring agent, and their parent if they are a sub-agent. */
  chainFor(playerId: string): { agent?: Agent; subAgent?: Agent } {
    const direct = this.referredBy.get(playerId);
    if (!direct) return {};
    const a = this.agents.get(direct);
    if (!a) return {};
    if (!a.parentAgentId) return { agent: a }; // referred directly by a top-level agent
    return { agent: this.agents.get(a.parentAgentId)!, subAgent: a };
  }
}
