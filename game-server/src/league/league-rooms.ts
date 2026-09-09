import { randomUUID } from 'node:crypto';
import { variant } from '../games/texas/variants';
import {
  effectiveSettings,
  validateSettings,
  LeagueRuleError,
  type LeagueSettings,
  type LeagueSettingsState,
  type PlatformLeaguePolicy,
} from './league';

/**
 * League private rooms (v5.9 §2 / 12-week plan W8).
 *
 * The doc draws the line, and it is not the one the lobby button implies:
 *
 *   "Platform Lobby (direct clients) + League Private Rooms (fully isolated).
 *    No cross-system interaction."
 *   "League private room system: league tables visible only to league members,
 *    completely invisible to lobby players."
 *
 * So a private table is created BY A LEAGUE, for its members — not by any lobby
 * player who fancies one. That is why this module takes a league context and a
 * membership role rather than a playerId and a wish.
 *
 * Three rules, each from the doc rather than from taste:
 *
 *   MEMBERS ONLY   creation requires OWNER or ADMIN in that league, and the
 *                  resulting table is only ever visible in that league's
 *                  context (the lobby service already enforces the read side
 *                  in both directions).
 *   LEAGUE RAKE    the rake is the league's own EFFECTIVE rate — the one in
 *                  force now, not a pending change still inside its 7-day
 *                  transition. A table opened today must charge today's rate.
 *   RAKE GOES HOME rake from a league table is League Inventory's, 100%. The
 *                  platform Treasury takes nothing from a private room.
 */

/** Who is asking, as established by the verified token plus a membership lookup. */
export interface LeagueRoomActor {
  playerId: string;
  leagueId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
}

export interface CreateLeagueRoomInput {
  /** Which poker variant the room hosts. */
  variantId: 'texas' | 'short-deck' | 'omaha';
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  /** Shown in the league's table list. */
  name?: string | undefined;
}

/** A room config the table hub can open, plus where its rake belongs. */
export interface LeagueRoomPlan {
  tableId: string;
  name: string;
  leagueId: string;
  variantId: 'texas' | 'short-deck' | 'omaha';
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  /** Basis points, the league's rate in force right now. */
  rakeBps: number;
  spectatorsAllowed: boolean;
  rakeDestination: 'LEAGUE_INVENTORY';
}

/** Only a league's own administration opens its rooms. */
const MAY_CREATE = new Set(['OWNER', 'ADMIN']);

export class LeagueRoomError extends Error {
  constructor(
    message: string,
    /** 404 for "not yours to see", 403 for "yours but not allowed". */
    readonly status: 403 | 404 | 400,
  ) {
    super(message);
    this.name = 'LeagueRoomError';
  }
}

/**
 * Plan a league private room, or refuse.
 *
 * Returns a plan rather than opening the table so the decision is testable
 * without a socket, a database or a hub — every rule below is a pure function of
 * the actor, the league's settings and the platform policy.
 *
 * A non-member gets 404, not 403: whether a given league exists and is running
 * tables is not information a stranger should be able to probe for. Same reason
 * the admin API answers 404 to non-ops.
 */
export function planLeagueRoom(
  actor: LeagueRoomActor,
  state: LeagueSettingsState,
  policy: PlatformLeaguePolicy,
  input: CreateLeagueRoomInput,
  now: number,
): LeagueRoomPlan {
  if (actor.role === null) {
    throw new LeagueRoomError(`no such league: ${actor.leagueId}`, 404);
  }
  if (!MAY_CREATE.has(actor.role)) {
    throw new LeagueRoomError('only a league owner or admin can open a table', 403);
  }

  if (input.bigBlind <= 0 || input.smallBlind <= 0) {
    throw new LeagueRoomError('blinds must be positive', 400);
  }
  if (input.smallBlind >= input.bigBlind) {
    throw new LeagueRoomError('the small blind must be smaller than the big blind', 400);
  }
  // Per VARIANT, not a flat 2..9. The old bound let a caller open a 9-seat
  // Hold'em table, whose felt only has seat positions for six — the extra three
  // fell through to an evenly-spaced circle and rendered inside the felt rather
  // than on the rail. See `PokerVariant.maxSeats`.
  const seatCap = variant(input.variantId).maxSeats;
  if (input.maxSeats < 2 || input.maxSeats > seatCap) {
    throw new LeagueRoomError(
      `a ${variant(input.variantId).name} table seats between 2 and ${seatCap}`,
      400,
    );
  }

  // The rate in force NOW. A pending change inside its 7-day transition must not
  // leak into a new table: opening a room is not a way to apply a rake early.
  const settings: LeagueSettings = effectiveSettings(state, now, policy);
  // Belt and braces: the stored rate came through validateSettings when it was
  // set, but a band narrowed since then would make it illegal, and a league
  // table charging an out-of-band rake is the failure this whole band exists to
  // prevent. Cheap to re-check, and it fails loudly rather than quietly.
  validateSettings(policy, settings);

  const buyIn = settings.buyIn;
  if (buyIn < policy.minBuyIn || buyIn > policy.maxBuyIn) {
    throw new LeagueRuleError('league buy-in is outside the platform range');
  }

  return {
    tableId: `lg-${actor.leagueId}-${randomUUID().slice(0, 8)}`,
    name: input.name?.trim() || `${actor.leagueId} table`,
    leagueId: actor.leagueId,
    variantId: input.variantId,
    smallBlind: input.smallBlind,
    bigBlind: input.bigBlind,
    // Buy-in is a league setting, expressed in currency; the table wants a
    // range. The 10x headroom is a product default (the spec sets only the
    // minimum), CLAMPED to the platform bound — the audit showed buyIn * 10
    // sailing past policy.maxBuyIn.
    minBuyIn: buyIn,
    maxBuyIn: Math.min(buyIn * 10, policy.maxBuyIn),
    maxSeats: input.maxSeats,
    rakeBps: settings.rakeBps,
    spectatorsAllowed: settings.spectatorsAllowed,
    // v5.9: league rake is League Inventory's, 100%. Never the Treasury.
    rakeDestination: 'LEAGUE_INVENTORY',
  };
}
