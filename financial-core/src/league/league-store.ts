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
  /**
   * The league's self-service settings (§2, 16-milestone plan). FACTS only —
   * the platform min/max band that bounds them, and the decision about which
   * rake is in force during a transition, are RULES and live in game-server
   * (`src/league/league.ts`), the same facts/rules split as reputation and VIP.
   *
   * Absent on leagues created before settings existed; the gateway supplies
   * platform defaults rather than inventing a rake here.
   */
  settings?: {
    rakeBps: number;
    tableHours: number;
    buyIn: number;
    spectatorsAllowed: boolean;
  };
  /**
   * A rake change accepted but not yet in force. The doc requires a 7-day
   * transition "enforced by platform (cannot apply early)", so `effectiveAt` is
   * stored rather than recomputed — a restart must not restart the clock, and
   * must not let a league shorten it by asking again either.
   */
  pendingRakeChange?: { rakeBps: number; effectiveAt: Date };
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
    settings: {
      type: new Schema(
        {
          rakeBps: { type: Number, required: true },
          tableHours: { type: Number, required: true },
          buyIn: { type: Number, required: true },
          spectatorsAllowed: { type: Boolean, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    pendingRakeChange: {
      type: new Schema(
        {
          rakeBps: { type: Number, required: true },
          effectiveAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
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

export interface LeagueSettingsFacts {
  rakeBps: number;
  tableHours: number;
  buyIn: number;
  spectatorsAllowed: boolean;
}

export interface League {
  leagueId: string;
  name: string;
  ownerId: string;
  description: string | null;
  inviteOnly: boolean;
  memberCount: number;
  createdAt: string;
  /** Null when this league has never set them; the caller applies platform defaults. */
  settings: LeagueSettingsFacts | null;
  /** A rake change not yet in force. `effectiveAt` is an ISO timestamp. */
  pendingRakeChange: { rakeBps: number; effectiveAt: string } | null;
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
    settings: doc.settings
      ? {
          rakeBps: doc.settings.rakeBps,
          tableHours: doc.settings.tableHours,
          buyIn: doc.settings.buyIn,
          spectatorsAllowed: doc.settings.spectatorsAllowed,
        }
      : null,
    pendingRakeChange: doc.pendingRakeChange
      ? {
          rakeBps: doc.pendingRakeChange.rakeBps,
          effectiveAt: doc.pendingRakeChange.effectiveAt.toISOString(),
        }
      : null,
  };
}

/**
 * Store a league's settings and any rake change still in transition.
 *
 * FACTS ONLY. This writes what it is given and validates nothing about the rake:
 * the platform min/max band and the 7-day transition are RULES, and they are
 * applied in game-server before this is called — the same split the codebase
 * uses for reputation and VIP. Putting a band check here as well would give two
 * answers to what a league may charge, and the two would drift.
 *
 * `pendingRakeChange: null` clears a transition (a league reverting, or the
 * change having been folded in).
 */
export async function putLeagueSettings(
  leagueId: string,
  settings: LeagueSettingsFacts,
  pendingRakeChange: { rakeBps: number; effectiveAt: Date } | null,
): Promise<League> {
  const res = await LeagueModel.updateOne(
    { _id: leagueId },
    pendingRakeChange
      ? { $set: { settings, pendingRakeChange } }
      : { $set: { settings }, $unset: { pendingRakeChange: '' } },
  );
  if (res.matchedCount === 0) throw new LeagueError(`no such league: ${leagueId}`);
  return (await getLeague(leagueId))!;
}

/**
 * Leagues whose scheduled rake change is now due.
 *
 * Indexed on nothing in particular because the population is small and this runs
 * on a timer, not per hand. Returns the raw pending change so the caller can
 * re-check it against the CURRENT band before folding it in — a rate that was
 * legal when requested may not be legal when it lands.
 */
export async function leaguesWithDueRakeChange(
  now: Date,
): Promise<{ leagueId: string; settings: LeagueSettingsFacts | null; pendingRakeChange: { rakeBps: number; effectiveAt: Date } }[]> {
  const docs = await LeagueModel.find({ 'pendingRakeChange.effectiveAt': { $lte: now } }).lean();
  return docs
    .filter((d): d is typeof d & { pendingRakeChange: { rakeBps: number; effectiveAt: Date } } =>
      Boolean(d.pendingRakeChange),
    )
    .map((d) => ({
      leagueId: d._id,
      settings: d.settings
        ? {
            rakeBps: d.settings.rakeBps,
            tableHours: d.settings.tableHours,
            buyIn: d.settings.buyIn,
            spectatorsAllowed: d.settings.spectatorsAllowed,
          }
        : null,
      pendingRakeChange: d.pendingRakeChange,
    }));
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
