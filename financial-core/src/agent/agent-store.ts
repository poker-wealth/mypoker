import { randomBytes, randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';

/**
 * Agents and referral bindings.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IRON RULE: an agent never sees a player's balance.
 *
 * Nothing in this module reads, returns, or can be joined to a balance. The
 * dashboard shapes below are the complete set of what an agent may know about
 * someone they referred — volume they generated, commission it produced, when
 * they were last active. There is no field to add a balance to and no query
 * here that could reach one.
 *
 * game-server/src/agents/agent-permissions.ts already states this in the type
 * system (agentCanTouchPlayerFunds returns literal `false`). This module is the
 * storage side of the same rule.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The commission ARITHMETIC lives in game-server/src/agents/commission.ts —
 * base rate, sub-agent bounds, VIP uplift, the league carve-out — and is not
 * duplicated here. This stores who is an agent, who they referred, and what has
 * been earned.
 */

export type AgentStatus = 'ACTIVE' | 'SUSPENDED';

interface AgentDoc {
  /** The agent IS a player; their playerId is the key. */
  _id: string;
  /** Null for a top-level agent; set for a sub-agent. */
  parentAgentId: string | null;
  /**
   * This agent's own commission rate in basis points.
   *
   * For a sub-agent, set by their parent within the bounds the domain enforces
   * (5% to parent_rate − 5%, so a parent always keeps at least 5%).
   */
  rateBps: number;
  status: AgentStatus;
  createdAt: Date;
}

interface ReferralBindingDoc {
  /** playerId — one binding per player, forever. */
  _id: string;
  directAgentId: string;
  /** The direct agent's parent at binding time, if any. */
  parentAgentId: string | null;
  /** Which link they arrived through, for per-channel stats. */
  linkId: string;
  createdAt: Date;
}

interface ReferralLinkDoc {
  /** UUID + 32-char salt, per spec. */
  _id: string;
  agentId: string;
  /** Agents may run several named links to compare channels. */
  label: string;
  createdAt: Date;
}

interface CommissionDoc {
  /** `${roundId}:${agentId}` — one credit per agent per round, ever. */
  _id: string;
  agentId: string;
  playerId: string;
  roundId: string;
  /** micro-USD */
  amount: number;
  /** DIRECT when the agent referred the player; OVERRIDE when via a sub-agent. */
  kind: 'DIRECT' | 'OVERRIDE';
  createdAt: Date;
}

const agentSchema = new Schema<AgentDoc>(
  {
    _id: { type: String, required: true },
    parentAgentId: { type: String, default: null, index: true },
    rateBps: { type: Number, required: true },
    status: { type: String, default: 'ACTIVE' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'agents' },
);

const bindingSchema = new Schema<ReferralBindingDoc>(
  {
    _id: { type: String, required: true },
    directAgentId: { type: String, required: true, index: true },
    parentAgentId: { type: String, default: null, index: true },
    linkId: { type: String, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'referral_bindings' },
);

const linkSchema = new Schema<ReferralLinkDoc>(
  {
    _id: { type: String, required: true },
    agentId: { type: String, required: true, index: true },
    label: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'referral_links' },
);

const commissionSchema = new Schema<CommissionDoc>(
  {
    _id: { type: String, required: true },
    agentId: { type: String, required: true, index: true },
    playerId: { type: String, required: true },
    roundId: { type: String, required: true },
    amount: { type: Number, required: true },
    kind: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'agent_commissions' },
);

export const AgentModel = model<AgentDoc>('Agent', agentSchema);
export const ReferralBindingModel = model<ReferralBindingDoc>('ReferralBinding', bindingSchema);
export const ReferralLinkModel = model<ReferralLinkDoc>('ReferralLink', linkSchema);
export const AgentCommissionModel = model<CommissionDoc>('AgentCommission', commissionSchema);

export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentError';
  }
}

export interface Agent {
  agentId: string;
  parentAgentId: string | null;
  rateBps: number;
  status: AgentStatus;
  createdAt: string;
}

export async function createAgent(input: {
  agentId: string;
  rateBps: number;
  parentAgentId?: string;
}): Promise<Agent> {
  if (await AgentModel.findById(input.agentId).lean()) {
    throw new AgentError('already an agent');
  }
  if (input.parentAgentId) {
    const parent = await AgentModel.findById(input.parentAgentId).lean();
    if (!parent) throw new AgentError('no such parent agent');
    // Two levels only, per spec. A sub-agent cannot itself have sub-agents, or
    // the override chain has no bound and commission stops being computable
    // from one round.
    if (parent.parentAgentId !== null) {
      throw new AgentError('agents are two levels only — a sub-agent cannot have sub-agents');
    }
  }

  await AgentModel.create({
    _id: input.agentId,
    parentAgentId: input.parentAgentId ?? null,
    rateBps: input.rateBps,
    status: 'ACTIVE',
  });
  return (await getAgent(input.agentId))!;
}

export async function getAgent(agentId: string): Promise<Agent | null> {
  const doc = await AgentModel.findById(agentId).lean();
  if (!doc) return null;
  return {
    agentId: doc._id,
    parentAgentId: doc.parentAgentId,
    rateBps: doc.rateBps,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** A referral link: UUID plus a 32-character salt, per spec. */
export async function createReferralLink(agentId: string, label = 'default'): Promise<string> {
  const agent = await AgentModel.findById(agentId).lean();
  if (!agent) throw new AgentError('not an agent');

  const linkId = `${randomUUID()}${randomBytes(16).toString('hex')}`;
  await ReferralLinkModel.create({ _id: linkId, agentId, label });
  return linkId;
}

export async function linksFor(agentId: string): Promise<{ linkId: string; label: string; registrations: number }[]> {
  const links = await ReferralLinkModel.find({ agentId }).lean();
  return Promise.all(
    links.map(async (l) => ({
      linkId: l._id,
      label: l.label,
      registrations: await ReferralBindingModel.countDocuments({ linkId: l._id }),
    })),
  );
}

/**
 * Bind a player to the agent whose link they arrived through.
 *
 * Permanent and set once, per spec: "set at registration, permanent, never
 * changes". A player who could be rebound would let two agents claim the same
 * lifetime volume, and the second claim would be indistinguishable from the
 * first. So a second attempt is a no-op, not an update.
 */
export async function bindReferral(playerId: string, linkId: string): Promise<void> {
  const existing = await ReferralBindingModel.findById(playerId).lean();
  if (existing) return; // already bound — silently, since a retried signup is not an error

  const link = await ReferralLinkModel.findById(linkId).lean();
  if (!link) throw new AgentError('unknown referral link');

  const agent = await AgentModel.findById(link.agentId).lean();
  if (!agent) throw new AgentError('referral link belongs to no agent');

  // A player cannot be their own referrer.
  if (playerId === link.agentId) throw new AgentError('an agent cannot refer themselves');

  await ReferralBindingModel.create({
    _id: playerId,
    directAgentId: link.agentId,
    parentAgentId: agent.parentAgentId,
    linkId,
  });
}

export async function referralFor(
  playerId: string,
): Promise<{ directAgentId: string; parentAgentId: string | null } | null> {
  const doc = await ReferralBindingModel.findById(playerId).lean();
  return doc ? { directAgentId: doc.directAgentId, parentAgentId: doc.parentAgentId } : null;
}

/**
 * Record commission earned on a round.
 *
 * Idempotent per (round, agent): settlement retries and replayed queue messages
 * must not pay an agent twice for one hand.
 */
export async function recordCommission(input: {
  agentId: string;
  playerId: string;
  roundId: string;
  amount: number;
  kind: 'DIRECT' | 'OVERRIDE';
}): Promise<void> {
  if (input.amount <= 0) return;
  const id = `${input.roundId}:${input.agentId}`;
  await AgentCommissionModel.updateOne(
    { _id: id },
    { $setOnInsert: { _id: id, ...input } },
    { upsert: true },
  );
}

/**
 * One row of the agent's player list.
 *
 * Note what is absent: there is no balance, and no field that could carry one.
 * An agent may know what a player generated for them, not what that player has.
 */
export interface ReferredPlayer {
  playerId: string;
  /** Commission this player has generated for this agent, micro-USD. */
  commissionGenerated: number;
  rounds: number;
  boundAt: string;
  lastActiveAt: string | null;
}

export async function playersOf(agentId: string): Promise<ReferredPlayer[]> {
  const bindings = await ReferralBindingModel.find({
    $or: [{ directAgentId: agentId }, { parentAgentId: agentId }],
  }).lean();

  return Promise.all(
    bindings.map(async (b) => {
      const rows = await AgentCommissionModel.find({ agentId, playerId: b._id }).lean();
      const commissionGenerated = rows.reduce((sum, r) => sum + r.amount, 0);
      const lastActive = rows.reduce<Date | null>(
        (latest, r) => (latest === null || r.createdAt > latest ? r.createdAt : latest),
        null,
      );
      return {
        playerId: b._id,
        commissionGenerated,
        rounds: rows.length,
        boundAt: b.createdAt.toISOString(),
        lastActiveAt: lastActive ? lastActive.toISOString() : null,
      };
    }),
  );
}

export interface AgentSummary {
  agentId: string;
  rateBps: number;
  status: AgentStatus;
  /** micro-USD, all time. */
  totalCommission: number;
  playerCount: number;
  subAgentCount: number;
}

export async function summaryFor(agentId: string): Promise<AgentSummary | null> {
  const agent = await getAgent(agentId);
  if (!agent) return null;

  const rows = await AgentCommissionModel.find({ agentId }).lean();
  return {
    agentId,
    rateBps: agent.rateBps,
    status: agent.status,
    totalCommission: rows.reduce((sum, r) => sum + r.amount, 0),
    playerCount: await ReferralBindingModel.countDocuments({
      $or: [{ directAgentId: agentId }, { parentAgentId: agentId }],
    }),
    subAgentCount: await AgentModel.countDocuments({ parentAgentId: agentId }),
  };
}

export async function subAgentsOf(agentId: string): Promise<Agent[]> {
  const docs = await AgentModel.find({ parentAgentId: agentId }).lean();
  return docs.map((d) => ({
    agentId: d._id,
    parentAgentId: d.parentAgentId,
    rateBps: d.rateBps,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
  }));
}

