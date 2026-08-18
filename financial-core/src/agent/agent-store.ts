import { randomBytes } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { volumeBetween, lifetimeEffectiveFor, dayKey, monthKey } from '../vip/volume-tracker';

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
  /** Which game the hand was — §13.4 Tab 4 lists it per record. */
  gameId: string;
  /** The hand's rake, micro-USD. The figure this commission was a cut OF. */
  rakeAmount: number;
  /** For OVERRIDE rows, the sub-agent the commission came up through. */
  viaAgentId: string | null;
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
    // Defaulted rather than required: rows written before these fields existed
    // are still readable, and a settlement record that cannot say which game it
    // came from is better than one that refuses to load.
    gameId: { type: String, default: 'unknown' },
    rakeAmount: { type: Number, default: 0 },
    viaAgentId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'agent_commissions' },
);

// Tab 4 pages by recency within a date window, per agent.
commissionSchema.index({ agentId: 1, createdAt: -1 });

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

  // 24 random bytes as hex = 48 characters, 192 bits of entropy.
  //
  // The length is a HARD CONSTRAINT, not a preference: this id is handed to
  // Telegram as the `start` deep-link parameter (t.me/<bot>?start=<linkId>),
  // which Telegram limits to 64 characters drawn from [A-Za-z0-9_-]. The
  // previous `randomUUID() + randomBytes(16)` produced 68, so every referral
  // link an agent shared was four characters too long for Telegram to open —
  // the entire acquisition flow handed out links that silently did not work.
  const linkId = randomBytes(24).toString('hex');
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
  gameId?: string;
  rakeAmount?: number;
  viaAgentId?: string | null;
}): Promise<void> {
  if (input.amount <= 0) return;
  const id = `${input.roundId}:${input.agentId}`;
  await AgentCommissionModel.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        _id: id,
        ...input,
        gameId: input.gameId ?? 'unknown',
        rakeAmount: input.rakeAmount ?? 0,
        viaAgentId: input.viaAgentId ?? null,
      },
    },
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
  /** Commission this player has generated for this agent, micro-USD, all time. */
  commissionGenerated: number;
  rounds: number;
  boundAt: string;
  lastActiveAt: string | null;
  /** The link they registered through — §13.4 Tab 2's "registration source". */
  linkId: string;
  /** Set when this player sits under a sub-agent rather than directly. */
  viaAgentId: string | null;
  /** micro-USD staked, today (UTC). */
  todayVolume: number;
  /** micro-USD staked, this calendar month (UTC). */
  monthVolume: number;
  /** micro-USD of commission this agent earned from them today. */
  todayCommission: number;
  monthCommission: number;
  /**
   * Cumulative effective volume, micro-USD. The gateway turns this into a VIP
   * tier — the ladder is a rule and lives with the other rules.
   */
  lifetimeEffective: number;
}

/**
 * The agent's downline, with the figures §13.4 Tab 2 lists.
 *
 * Note what is still absent: a balance, and any field that could carry one.
 * §13.6 draws that line — an agent may see what a player generated for them,
 * never what that player holds — and the way to keep a line like that is to
 * have nowhere to put the number.
 *
 * Volume and commission are fetched in two batched queries rather than per
 * player; a downline of a few hundred was otherwise a few hundred round trips.
 */
export async function playersOf(agentId: string, now = new Date()): Promise<ReferredPlayer[]> {
  const bindings = await ReferralBindingModel.find({
    $or: [{ directAgentId: agentId }, { parentAgentId: agentId }],
  }).lean();
  if (bindings.length === 0) return [];

  const playerIds = bindings.map((b) => b._id);
  const today = dayKey(now);
  const monthStart = `${monthKey(now)}-01`;

  const [rows, todayVol, monthVol, lifetime] = await Promise.all([
    AgentCommissionModel.find({ agentId, playerId: { $in: playerIds } }).lean(),
    volumeBetween(playerIds, today, today),
    volumeBetween(playerIds, monthStart, today),
    lifetimeEffectiveFor(playerIds),
  ]);

  const startOfToday = new Date(`${today}T00:00:00.000Z`);
  const startOfMonth = new Date(`${monthStart}T00:00:00.000Z`);

  const byPlayer = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byPlayer.get(r.playerId) ?? [];
    list.push(r);
    byPlayer.set(r.playerId, list);
  }

  return bindings.map((b) => {
    const mine = byPlayer.get(b._id) ?? [];
    const sum = (since: Date): number =>
      mine.reduce((total, r) => (r.createdAt >= since ? total + r.amount : total), 0);
    const lastActive = mine.reduce<Date | null>(
      (latest, r) => (latest === null || r.createdAt > latest ? r.createdAt : latest),
      null,
    );

    return {
      playerId: b._id,
      commissionGenerated: mine.reduce((total, r) => total + r.amount, 0),
      rounds: mine.length,
      boundAt: b.createdAt.toISOString(),
      lastActiveAt: lastActive ? lastActive.toISOString() : null,
      linkId: b.linkId,
      viaAgentId: b.parentAgentId === agentId ? b.directAgentId : null,
      todayVolume: todayVol.get(b._id)?.staked ?? 0,
      monthVolume: monthVol.get(b._id)?.staked ?? 0,
      todayCommission: sum(startOfToday),
      monthCommission: sum(startOfMonth),
      lifetimeEffective: lifetime.get(b._id) ?? 0,
    };
  });
}

export interface AgentSummary {
  agentId: string;
  /**
   * Null for a top-level agent, set for a sub-agent.
   *
   * §13.4's entry card carries an "agent tier badge", and this is what
   * distinguishes the two tiers. It cannot be inferred from subAgentCount — a
   * newly approved top-level agent has no sub-agents either.
   */
  parentAgentId: string | null;
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
    parentAgentId: agent.parentAgentId,
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

// ─── §13.4 dashboard reads ───────────────────────────────────────────────────
//
// Everything below returns FACTS — sums, rows, dates. No tier is named, no
// activity colour is chosen, no rate ceiling is judged. Those are rules, and
// rules live in the gateway (game-server/src/players, /agents) so there is one
// home for each. This module is the ledger of what happened.

/** The three rows §13.4 Tab 1 shows for a period. */
export interface CommissionBreakdown {
  /** micro-USD */
  total: number;
  /** From players this agent referred directly. */
  direct: number;
  /** Upstream cut from sub-agents' players. */
  override: number;
}

export async function commissionBreakdown(
  agentId: string,
  window: { from: Date; to: Date },
): Promise<CommissionBreakdown> {
  const rows = await AgentCommissionModel.aggregate<{ _id: string; amount: number }>([
    { $match: { agentId, createdAt: { $gte: window.from, $lte: window.to } } },
    { $group: { _id: '$kind', amount: { $sum: '$amount' } } },
  ]);

  const direct = rows.find((r) => r._id === 'DIRECT')?.amount ?? 0;
  const override = rows.find((r) => r._id === 'OVERRIDE')?.amount ?? 0;
  return { total: direct + override, direct, override };
}

/** One point per day for Tab 1's trend chart. Days with no commission are absent. */
export async function commissionSeries(
  agentId: string,
  window: { from: Date; to: Date },
): Promise<{ date: string; amount: number }[]> {
  const rows = await AgentCommissionModel.aggregate<{ _id: string; amount: number }>([
    { $match: { agentId, createdAt: { $gte: window.from, $lte: window.to } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        amount: { $sum: '$amount' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((r) => ({ date: r._id, amount: r.amount }));
}

/** One row of Tab 4. */
export interface SettlementRecord {
  recordId: string;
  at: string;
  playerId: string;
  /** Set when the commission came up through a sub-agent. */
  viaAgentId: string | null;
  kind: 'DIRECT' | 'OVERRIDE';
  gameId: string;
  roundId: string;
  /** micro-USD */
  rakeAmount: number;
  /** micro-USD */
  amount: number;
}

/**
 * Settlement records for a window, newest first.
 *
 * Capped, and the cap is reported rather than silently applied — an agent
 * reconciling against their own figures needs to know the list was truncated,
 * or they will conclude the platform is short-paying them.
 */
export async function settlementRecords(
  agentId: string,
  opts: { from: Date; to: Date; source?: 'DIRECT' | 'OVERRIDE'; limit?: number },
): Promise<{ records: SettlementRecord[]; truncated: boolean }> {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const query: Record<string, unknown> = {
    agentId,
    createdAt: { $gte: opts.from, $lte: opts.to },
  };
  if (opts.source) query.kind = opts.source;

  const docs = await AgentCommissionModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();

  const truncated = docs.length > limit;
  return {
    truncated,
    records: docs.slice(0, limit).map((d) => ({
      recordId: d._id,
      at: d.createdAt.toISOString(),
      playerId: d.playerId,
      viaAgentId: d.viaAgentId ?? null,
      kind: d.kind,
      gameId: d.gameId ?? 'unknown',
      roundId: d.roundId,
      rakeAmount: d.rakeAmount ?? 0,
      amount: d.amount,
    })),
  };
}

/**
 * Set a sub-agent's commission rate (§13.1).
 *
 * The 5%–25% range and the "A must retain 5%" ceiling are NOT checked here.
 * They live in the gateway — `assertValidSubAgentRate` in
 * game-server/src/agents/commission.ts — alongside the split arithmetic that
 * has to agree with them. Restating them would give two answers to who keeps
 * what, and the copies would drift.
 *
 * What this does enforce is ownership: the update is scoped to the caller's own
 * sub-agents, because §13.1 makes B's rate "set and owned by A". Another agent
 * asking finds nothing rather than being told the sub-agent exists.
 */
export async function setSubAgentRate(
  parentAgentId: string,
  subAgentId: string,
  rateBps: number,
): Promise<void> {
  const result = await AgentModel.updateOne(
    { _id: subAgentId, parentAgentId },
    { $set: { rateBps } },
  );
  if (result.matchedCount === 0) throw new AgentError('sub-agent not found');
}

