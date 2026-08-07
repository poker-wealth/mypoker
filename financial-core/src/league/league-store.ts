import { Schema, model } from 'mongoose';

/**
 * Leagues (Alliances) and who belongs to them.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IRON RULE: Platform and League stay isolated.
 *
 * A player inside a league context must never see platform tables or their
 * platform wallet, and vice versa. That is not a UI preference — league money
 * lives in LEAGUE_INVENTORY and platform money in the player's own account, and
 * showing one balance while operating in the other's context is how a player
 * ends up buying into a table with money that was never there.
 *
 * Enforced here by making context an explicit, required argument rather than an
 * ambient default: nothing in this module can be queried without saying which
 * side of the boundary you are on. A missing context is a type error, not a
 * silent fallback to platform.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Lives in financial-core because it is the only service with a database. The
 * league DOMAIN rules — rake bounds, table hours, which risk controls the
 * platform always wins — already exist in game-server/src/league and are not
 * duplicated here.
 */

/** Which side of the isolation boundary a request is operating on. */
export type WalletContext =
  | { kind: 'PLATFORM' }
  | { kind: 'LEAGUE'; leagueId: string };

export const PLATFORM: WalletContext = { kind: 'PLATFORM' };
export const leagueContext = (leagueId: string): WalletContext => ({ kind: 'LEAGUE', leagueId });

export type LeagueRole = 'OWNER' | 'ADMIN' | 'MEMBER';

interface LeagueDoc {
  _id: string;
  name: string;
  ownerId: string;
  /** Free-text, shown in the alliance list. */
  description?: string;
  /** Invite-only leagues never appear in discovery. */
  inviteOnly: boolean;
  createdAt: Date;
}

interface MembershipDoc {
  /** `${leagueId}:${playerId}` — makes double-joining impossible by construction. */
  _id: string;
  leagueId: string;
  playerId: string;
  role: LeagueRole;
  createdAt: Date;
}

const leagueSchema = new Schema<LeagueDoc>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    ownerId: { type: String, required: true, index: true },
    description: { type: String },
    inviteOnly: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'leagues' },
);

const membershipSchema = new Schema<MembershipDoc>(
  {
    _id: { type: String, required: true },
    leagueId: { type: String, required: true, index: true },
    playerId: { type: String, required: true, index: true },
    role: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'league_memberships' },
);

export const LeagueModel = model<LeagueDoc>('League', leagueSchema);
export const MembershipModel = model<MembershipDoc>('LeagueMembership', membershipSchema);

export interface League {
  leagueId: string;
  name: string;
  ownerId: string;
  description: string | null;
  inviteOnly: boolean;
  memberCount: number;
  createdAt: string;
}

const membershipId = (leagueId: string, playerId: string): string => `${leagueId}:${playerId}`;

export class LeagueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeagueError';
  }
}

export async function createLeague(input: {
  leagueId: string;
  name: string;
  ownerId: string;
  description?: string;
  inviteOnly?: boolean;
}): Promise<League> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 40) {
    throw new LeagueError('league name must be 2–40 characters');
  }

  const existing = await LeagueModel.findById(input.leagueId).lean();
  if (existing) throw new LeagueError('league already exists');

  await LeagueModel.create({
    _id: input.leagueId,
    name,
    ownerId: input.ownerId,
    ...(input.description !== undefined ? { description: input.description } : {}),
    inviteOnly: input.inviteOnly ?? false,
  });

  // The creator is a member from the outset. A league whose owner is not in it
  // would pass every membership check while its own admin is treated as an
  // outsider.
  await MembershipModel.create({
    _id: membershipId(input.leagueId, input.ownerId),
    leagueId: input.leagueId,
    playerId: input.ownerId,
    role: 'OWNER',
  });

  return (await getLeague(input.leagueId))!;
}

export async function getLeague(leagueId: string): Promise<League | null> {
  const doc = await LeagueModel.findById(leagueId).lean();
  if (!doc) return null;
  const memberCount = await MembershipModel.countDocuments({ leagueId });
  return {
    leagueId: doc._id,
    name: doc.name,
    ownerId: doc.ownerId,
    description: doc.description ?? null,
    inviteOnly: doc.inviteOnly,
    memberCount,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** Join. Idempotent — a double tap must not create a second membership. */
export async function joinLeague(leagueId: string, playerId: string): Promise<void> {
  const league = await LeagueModel.findById(leagueId).lean();
  if (!league) throw new LeagueError('no such league');
  if (league.inviteOnly) throw new LeagueError('this league is invite-only');

  await MembershipModel.updateOne(
    { _id: membershipId(leagueId, playerId) },
    { $setOnInsert: { _id: membershipId(leagueId, playerId), leagueId, playerId, role: 'MEMBER' } },
    { upsert: true },
  );
}

export async function leaveLeague(leagueId: string, playerId: string): Promise<void> {
  const league = await LeagueModel.findById(leagueId).lean();
  // The owner leaving would strand the league with no admin and no way to
  // appoint one. Transfer of ownership is a separate operation.
  if (league && league.ownerId === playerId) {
    throw new LeagueError('the owner cannot leave their own league');
  }
  await MembershipModel.deleteOne({ _id: membershipId(leagueId, playerId) });
}

export async function membershipOf(leagueId: string, playerId: string): Promise<LeagueRole | null> {
  const doc = await MembershipModel.findById(membershipId(leagueId, playerId)).lean();
  return doc ? doc.role : null;
}

/** Every league this player belongs to. */
export async function leaguesFor(playerId: string): Promise<League[]> {
  const memberships = await MembershipModel.find({ playerId }).lean();
  const leagues = await Promise.all(memberships.map((m) => getLeague(m.leagueId)));
  return leagues.filter((l): l is League => l !== null);
}

/** Discoverable leagues — invite-only ones are excluded by definition. */
export async function discoverLeagues(limit = 20): Promise<League[]> {
  const docs = await LeagueModel.find({ inviteOnly: false }).limit(limit).lean();
  const leagues = await Promise.all(docs.map((d) => getLeague(d._id)));
  return leagues.filter((l): l is League => l !== null);
}

/**
 * Assert a player may operate in a context, and throw if not.
 *
 * The single choke point for the isolation rule. Any read or write that depends
 * on context should call this first, so "am I allowed to see this" is answered
 * in one place rather than re-derived at each call site — which is how one
 * forgotten check becomes a player looking at another league's tables.
 */
export async function assertContextAccess(
  context: WalletContext,
  playerId: string,
): Promise<void> {
  if (context.kind === 'PLATFORM') return; // every player has a platform context

  const role = await membershipOf(context.leagueId, playerId);
  if (!role) throw new LeagueError('not a member of this league');
}

/**
 * Which account a buy-in, rake or balance read belongs to in this context.
 *
 * Deliberately total: there is no "either" and no default. Getting this wrong is
 * not a display bug — it is money moving between the platform and a league,
 * which the iron rules forbid outright.
 */
export function accountScopeFor(context: WalletContext): 'PLATFORM' | 'LEAGUE_INVENTORY' {
  return context.kind === 'PLATFORM' ? 'PLATFORM' : 'LEAGUE_INVENTORY';
}
