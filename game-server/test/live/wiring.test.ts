import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { createRoom, hostableGames, type LiveTableConfig } from '../../src/live/live-room';
import { defaultTables } from '../../src/live/server';
import { GAME_IDS } from '../../src/lobby/game-catalog';
import '../../src/live/rooms';

/**
 * EVERY CATALOGUED GAME IS ACTUALLY REACHABLE.
 *
 * A game needs three things to exist for a player: an entry in the catalogue, a room registered
 * against its id, and a table opened with a config that room can use. Lose any one and the game is
 * gone — but nothing says so directly. When `rooms.ts` and `server.ts` were reverted in the working
 * tree, the symptom was eight unrelated suites failing with confusing errors and only Hold'em
 * reachable; it took a merge conflict an hour later to notice why.
 *
 * This says it plainly, by name. It also catches the opposite mistake — a game added to the
 * catalogue and never wired up, which is how `texas-cowboy` broke the regression suite.
 */

const tables = defaultTables();

describe('every catalogued game is wired up', () => {
  it.each(GAME_IDS)('%s has a room registered for it', (gameId) => {
    expect(hostableGames()).toContain(gameId);
  });

  it.each(GAME_IDS)('%s has a table in defaultTables()', (gameId) => {
    const opened = tables.filter((t) => t.game === gameId);
    expect(opened.length).toBeGreaterThan(0);
  });

  it('opens no table for a game that has no room', () => {
    for (const table of tables) {
      expect(hostableGames()).toContain(table.game);
    }
  });

  it('gives every table a unique id', () => {
    const ids = tables.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('every opened table can actually be built', () => {
  it.each(tables.map((t) => [String(t.id), t] as const))('%s', (_id, config) => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const room = createRoom(config as LiveTableConfig, {
      directory: players,
      fc: new ChipBank(players),
    });
    // Rooms that run on a clock start one in their constructor; shut it down again.
    room.dispose();
  });
});

describe('a table cannot open without the figures it settles with', () => {
  const build = (config: Record<string, unknown>): void => {
    const players = new DevPlayers({ startingChips: 10_000 });
    createRoom(config as unknown as LiveTableConfig, {
      directory: players,
      fc: new ChipBank(players),
    }).dispose();
  };

  it('refuses a rake that is not a number, naming the table', () => {
    // This is the failure that reached production as `bad settlement amount: NaN`, from deep in the
    // ledger, with nothing to say which table caused it.
    expect(() =>
      build({
        id: 'baccarat-broken',
        name: 'Broken Baccarat',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 8,
        tiePayout: 8,
        // rakeBps missing
      }),
    ).toThrow(/baccarat-broken.*rakeBps must be a number/);
  });

  it('refuses a table whose buy-in range is upside down', () => {
    expect(() =>
      build({
        id: 'silly-limits',
        name: 'Silly Limits',
        game: 'niu-niu',
        minBuyIn: 50_000,
        maxBuyIn: 1_000,
        maxSeats: 6,
        rakeBps: 500,
      }),
    ).toThrow(/exceeds maxBuyIn/);
  });

  it('refuses a table with no seats', () => {
    expect(() =>
      build({
        id: 'no-seats',
        name: 'No Seats',
        game: 'niu-niu',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 0,
        rakeBps: 500,
      }),
    ).toThrow(/maxSeats must be at least 1/);
  });
});
