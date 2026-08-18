import { planLeagueRoom, LeagueRoomError, type LeagueRoomActor } from '../../src/league/league-rooms';
import {
  requestSettingsChange,
  type LeagueSettings,
  type LeagueSettingsState,
  type PlatformLeaguePolicy,
} from '../../src/league/league';

/**
 * League private rooms (v5.9 §2, 12-week plan W8).
 *
 * "Platform Lobby (direct clients) + League Private Rooms (fully isolated). No
 * cross-system interaction." — so a private table belongs to a league and is
 * opened by that league's administration, not by any lobby player who wants one.
 *
 * The read side of the isolation is already enforced and tested in the lobby
 * service (both directions). What is tested here is the WRITE side: who may open
 * a room, and what rake it opens with.
 */

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
const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const actor = (role: LeagueRoomActor['role']): LeagueRoomActor => ({
  playerId: 'p1',
  leagueId: 'macau-01',
  role,
});

const input = { variantId: 'texas' as const, smallBlind: 10, bigBlind: 20, maxSeats: 6 };

describe('who may open a league room', () => {
  it.each([['OWNER'], ['ADMIN']] as const)('%s can', (role) => {
    const plan = planLeagueRoom(actor(role), state, policy, input, T0);
    expect(plan.leagueId).toBe('macau-01');
    expect(plan.tableId.startsWith('lg-macau-01-')).toBe(true);
  });

  it('a plain MEMBER cannot — 403', () => {
    // A member can play in the room; opening one is administration.
    try {
      planLeagueRoom(actor('MEMBER'), state, policy, input, T0);
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(LeagueRoomError);
      expect((e as LeagueRoomError).status).toBe(403);
    }
  });

  it('a non-member gets 404, not 403', () => {
    // Whether a league exists and is running tables is not something a stranger
    // should be able to probe for. Same reason the admin API answers 404.
    try {
      planLeagueRoom(actor(null), state, policy, input, T0);
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as LeagueRoomError).status).toBe(404);
      expect((e as Error).message).not.toMatch(/permission|forbidden|role/i);
    }
  });
});

describe('the room opens on the rake actually in force', () => {
  it('uses the league rate, not a platform default', () => {
    expect(planLeagueRoom(actor('OWNER'), state, policy, input, T0).rakeBps).toBe(300);
  });

  it('ignores a rake change still inside its 7-day transition', () => {
    // THE ONE THAT MATTERS. Opening a new table must not be a way to apply a
    // rake change early — that would route straight around the 7-day rule.
    const { state: scheduled } = requestSettingsChange(policy, state, { ...settings, rakeBps: 700 }, T0);

    expect(planLeagueRoom(actor('OWNER'), scheduled, policy, input, T0).rakeBps).toBe(300);
    expect(planLeagueRoom(actor('OWNER'), scheduled, policy, input, T0 + 6 * DAY).rakeBps).toBe(300);
  });

  it('uses the new rate once the transition has actually run', () => {
    const { state: scheduled } = requestSettingsChange(policy, state, { ...settings, rakeBps: 700 }, T0);
    expect(planLeagueRoom(actor('OWNER'), scheduled, policy, input, T0 + 7 * DAY).rakeBps).toBe(700);
  });

  it('refuses to open a table on a rate the platform has since made illegal', () => {
    const narrowed: PlatformLeaguePolicy = { ...policy, minRakeBps: 400 };
    // The league's stored 300 was legal when set and is not any more.
    expect(() => planLeagueRoom(actor('OWNER'), state, narrowed, input, T0)).toThrow(
      /outside the platform range/,
    );
  });
});

describe('rake from a league room belongs to the league', () => {
  it('is League Inventory, 100%, never the Treasury', () => {
    // v5.9: "League Private Rooms ... rake -> League Inventory 100%".
    expect(planLeagueRoom(actor('OWNER'), state, policy, input, T0).rakeDestination).toBe(
      'LEAGUE_INVENTORY',
    );
  });
});

describe('table shape is validated before a room is opened', () => {
  it.each([
    ['a non-positive big blind', { ...input, bigBlind: 0 }],
    ['a small blind at or above the big blind', { ...input, smallBlind: 20, bigBlind: 20 }],
    ['fewer than two seats', { ...input, maxSeats: 1 }],
    ['more than nine seats', { ...input, maxSeats: 10 }],
  ])('refuses %s', (_what, bad) => {
    try {
      planLeagueRoom(actor('OWNER'), state, policy, bad, T0);
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as LeagueRoomError).status).toBe(400);
    }
  });

  it('carries the league buy-in and spectator setting onto the table', () => {
    const closed: LeagueSettingsState = {
      settings: { ...settings, spectatorsAllowed: false },
      pendingRakeChange: null,
    };
    const plan = planLeagueRoom(actor('OWNER'), closed, policy, input, T0);
    expect(plan.minBuyIn).toBe(400);
    expect(plan.spectatorsAllowed).toBe(false);
  });

  it('clamps the buy-in headroom to the platform bound', () => {
    // buyIn * 10 is a product default; the audit showed it sailing past
    // policy.maxBuyIn (buyIn 1,000,000 → table max 10,000,000 with the bound
    // at 1,000,000).
    const rich: LeagueSettingsState = {
      settings: { ...settings, buyIn: 5_000 },
      pendingRakeChange: null,
    };
    const plan = planLeagueRoom(actor('OWNER'), rich, policy, input, T0);
    expect(plan.maxBuyIn).toBe(policy.maxBuyIn); // 50,000 clamped to 10,000
  });

  it('gives every room a distinct id', () => {
    const ids = new Set(
      Array.from({ length: 20 }, () => planLeagueRoom(actor('OWNER'), state, policy, input, T0).tableId),
    );
    expect(ids.size).toBe(20);
  });
});
