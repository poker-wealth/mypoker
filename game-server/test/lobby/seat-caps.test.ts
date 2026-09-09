import { GAME_CATALOG } from '../../src/lobby/game-catalog';
import { VARIANTS, variant, type VariantId } from '../../src/games/texas/variants';
import { defaultTables } from '../../src/live/server';
import { DEFAULT_ROOM } from '../../src/live/poker-room';
import { planLeagueRoom, LeagueRoomError, type LeagueRoomActor } from '../../src/league/league-rooms';
import type {
  LeagueSettings,
  LeagueSettingsState,
  PlatformLeaguePolicy,
} from '../../src/league/league';

/**
 * How many chairs a poker table may have, and the fact that only ONE thing
 * decides it.
 *
 * There were three answers to that question and they disagreed. The lobby
 * catalogue advertised 9 seats for Hold'em, Short Deck and Omaha alike; the
 * live rooms actually seated 6, 8 and 6; and league table creation accepted
 * anything from 2 to 9 for any variant, with nothing checking either of the
 * other two.
 *
 * The one that matters is the FELT. `frontend/src/lib/tableDesigns.ts` defines
 * seat positions per count and then stops — the portrait stadium felt at 6, the
 * wide landscape felt at 8. Ask for more and `ringFor` falls through to an
 * evenly-spaced circle, which on an oval table seats people in the middle of
 * the felt rather than on the rail. So a 7-seat Hold'em table was not a policy
 * question; it rendered wrong.
 *
 * `PokerVariant.maxSeats` is now the single answer and everything else derives
 * from it. These tests exist to keep it that way, because the failure is quiet:
 * nothing throws, the table just looks broken.
 */

const POKER: VariantId[] = ['texas', 'short-deck', 'omaha'];

/** What a room seats when its config does not say — the house table. */
const DEFAULT_SEATS = DEFAULT_ROOM.maxSeats;

describe('one source of truth', () => {
  it.each(POKER)('the lobby catalogue reports %s exactly as the variant defines it', (id) => {
    expect(GAME_CATALOG[id].maxPlayers).toBe(variant(id).maxSeats);
  });

  it('every poker variant declares a cap', () => {
    for (const v of Object.values(VARIANTS)) {
      expect(typeof v.maxSeats).toBe('number');
      expect(v.maxSeats).toBeGreaterThanOrEqual(2);
    }
  });

  /**
   * The engine carries its own hard limit (`TexasGame.maxPlayers`), which throws
   * "table full". It is a backstop, so it may sit above a variant cap — but if
   * it ever sits BELOW one, a table the room happily seats would be refused by
   * the engine mid-hand.
   */
  it('no variant cap exceeds the engine hard limit', () => {
    const ENGINE_HARD_LIMIT = 9; // TexasGame.maxPlayers
    for (const id of POKER) {
      expect(variant(id).maxSeats).toBeLessThanOrEqual(ENGINE_HARD_LIMIT);
    }
  });
});

describe('the tables we ship respect their own cap', () => {
  it('no default room seats more than its variant allows', () => {
    // Filter on `game`, not on variantId. The other tables — baccarat, niu-niu,
    // the rest — carry no variantId at all, and defaulting them to 'texas' made
    // this test measure an 8-seat baccarat table against the Hold'em felt.
    const pokerRooms = defaultTables().filter((t) =>
      POKER.includes(t.game as VariantId),
    );
    // Guards the guard: if the filter matched nothing this test proves nothing.
    expect(pokerRooms.length).toBeGreaterThanOrEqual(3);

    const measured: { table: string; variant: VariantId; seats: number; cap: number }[] =
      pokerRooms.map((room) => {
        const id = (room as { variantId?: VariantId }).variantId ?? (room.game as VariantId);
        const seats = Number((room as { maxSeats?: number }).maxSeats ?? DEFAULT_SEATS);
        return { table: room.id, variant: id, seats, cap: variant(id).maxSeats };
      });
    const oversized = measured.filter((r) => r.seats > r.cap);

    expect(oversized).toEqual([]);
  });
});

describe('league table creation enforces the cap per variant', () => {
  const policy: PlatformLeaguePolicy = {
    minRakeBps: 100,
    maxRakeBps: 700,
    maxTableHours: 24,
    minBuyIn: 100,
    maxBuyIn: 10_000,
  };
  const settings: LeagueSettings = {
    rakeBps: 300,
    tableHours: 12,
    buyIn: 400,
    spectatorsAllowed: true,
  };
  const state: LeagueSettingsState = { settings, pendingRakeChange: null };
  const owner: LeagueRoomActor = { playerId: 'p1', leagueId: 'macau-01', role: 'OWNER' };
  const T0 = 1_700_000_000_000;

  const open = (variantId: VariantId, maxSeats: number): unknown =>
    planLeagueRoom(owner, state, policy, { variantId, smallBlind: 10, bigBlind: 20, maxSeats }, T0);

  it.each(POKER)('%s accepts exactly its cap', (id) => {
    expect(() => open(id, variant(id).maxSeats)).not.toThrow();
  });

  it.each(POKER)('%s refuses one seat above its cap', (id) => {
    const over = variant(id).maxSeats + 1;
    try {
      open(id, over);
      throw new Error(`expected ${id} to refuse ${over} seats`);
    } catch (e) {
      expect(e).toBeInstanceOf(LeagueRoomError);
      expect((e as LeagueRoomError).status).toBe(400);
      // The message has to name the real ceiling — "between 2 and 9" sent the
      // player back to try a number that would also be refused.
      expect((e as Error).message).toContain(String(variant(id).maxSeats));
    }
  });

  /**
   * The specific case that used to get through: nine seats on the portrait
   * felt. It was accepted by every layer and only went wrong on screen.
   */
  it('refuses the 9-seat Hold’em table that used to be allowed', () => {
    expect(() => open('texas', 9)).toThrow(LeagueRoomError);
  });

  it('still refuses fewer than two, which is not a table', () => {
    expect(() => open('texas', 1)).toThrow(LeagueRoomError);
  });
});
