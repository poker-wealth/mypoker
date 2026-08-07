import { LobbyService, PLATFORM_CONTEXT, type ViewerContext } from '../../src/lobby/lobby-service';

/**
 * Platform / League isolation in the lobby (iron rule 6; spec line 46:
 * "League Private Room: Tables created by leagues. Only visible to league
 * members. Lobby players CANNOT see it.").
 *
 * The gate this file exists to hold: "lobby never sees league tables; league
 * wallet only in league context". It has to be tested against real league
 * tables — an empty lobby passes any isolation check vacuously, which is
 * exactly the trap this feature was in before.
 */

const LEAGUE = 'league-macau';
const OTHER_LEAGUE = 'league-xuzhou';

const inLeague = (leagueId: string, memberOf: string[] = [leagueId]): ViewerContext => ({
  leagueId,
  memberOf,
});

function seeded(): LobbyService {
  const lobby = new LobbyService();
  lobby.addTable({ id: 'plat-1', gameId: 'texas', stakes: 2, players: 4, jackpot: 500, buyInBB: 40 });
  lobby.addTable({ id: 'plat-2', gameId: 'texas', stakes: 10, players: 2, jackpot: 900, buyInBB: 40 });
  lobby.addTable({
    id: 'lg-1',
    gameId: 'texas',
    stakes: 5,
    players: 6,
    jackpot: 7_000,
    buyInBB: 40,
    tableType: 'LEAGUE',
    leagueId: LEAGUE,
  });
  lobby.addTable({
    id: 'lg-2',
    gameId: 'texas',
    stakes: 5,
    players: 3,
    jackpot: 4_000,
    buyInBB: 40,
    tableType: 'LEAGUE',
    leagueId: OTHER_LEAGUE,
  });
  return lobby;
}

describe('the public lobby never sees a league table', () => {
  const lobby = seeded();

  it('lists platform tables only', () => {
    const ids = lobby.listTables({}, PLATFORM_CONTEXT).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['plat-1', 'plat-2']));
    expect(ids).not.toContain('lg-1');
    expect(ids).not.toContain('lg-2');
  });

  it('defaults to the public lobby when no context is passed at all', () => {
    // A forgotten argument must hide private rooms, not expose them.
    expect(lobby.listTables().map((t) => t.id)).not.toContain('lg-1');
  });

  it('cannot open a league table by id', () => {
    expect(lobby.getTable('lg-1', PLATFORM_CONTEXT)).toBeUndefined();
  });

  it('reports a hidden table as missing rather than forbidden', () => {
    // Distinguishing the two would turn the lobby into an oracle for which
    // leagues are running which tables.
    expect(lobby.getTable('lg-1', PLATFORM_CONTEXT)).toBe(lobby.getTable('no-such-table'));
  });

  it('excludes league players and jackpots from the public game rail', () => {
    const texas = lobby.listGames(PLATFORM_CONTEXT).find((g) => g.gameId === 'texas')!;
    expect(texas.tables).toBe(2);
    expect(texas.players).toBe(6); // 4 + 2, not 15
    expect(texas.jackpot).toBe(1_400); // 500 + 900, no league pools
  });

  it('excludes league pools from the public jackpot ticker', () => {
    expect(lobby.totalJackpot(PLATFORM_CONTEXT)).toBe(1_400);
  });
});

describe('a league context never sees platform tables', () => {
  const lobby = seeded();

  it('shows only that league’s own room', () => {
    const ids = lobby.listTables({}, inLeague(LEAGUE)).map((t) => t.id);
    expect(ids).toEqual(['lg-1']);
  });

  it('does not show another league’s room', () => {
    const ids = lobby.listTables({}, inLeague(LEAGUE, [LEAGUE, OTHER_LEAGUE])).map((t) => t.id);
    // Member of both, but looking at one: the OTHER league's room is still not
    // part of this context.
    expect(ids).toEqual(['lg-1']);
  });

  it('scopes the game rail and ticker to the league', () => {
    const ctx = inLeague(LEAGUE);
    const texas = lobby.listGames(ctx).find((g) => g.gameId === 'texas')!;
    expect(texas.tables).toBe(1);
    expect(texas.players).toBe(6);
    expect(lobby.totalJackpot(ctx)).toBe(7_000);
  });
});

describe('membership is checked, not just claimed', () => {
  const lobby = seeded();

  it('shows nothing to a context for a league the viewer does not belong to', () => {
    // A fabricated context must not open the room. Carrying a leagueId is not
    // the same as belonging to it.
    const impostor: ViewerContext = { leagueId: LEAGUE, memberOf: [] };
    expect(lobby.listTables({}, impostor)).toEqual([]);
    expect(lobby.getTable('lg-1', impostor)).toBeUndefined();
    expect(lobby.totalJackpot(impostor)).toBe(0);
  });

  it('does not let membership in one league open another', () => {
    const wrong: ViewerContext = { leagueId: OTHER_LEAGUE, memberOf: [LEAGUE] };
    expect(lobby.listTables({}, wrong)).toEqual([]);
  });
});

describe('filters compose with isolation rather than bypassing it', () => {
  const lobby = seeded();

  it('cannot reach a league table through a stake filter', () => {
    const ids = lobby.listTables({ minStakes: 5, maxStakes: 5 }, PLATFORM_CONTEXT).map((t) => t.id);
    expect(ids).toEqual([]);
  });

  it('cannot reach one through a jackpot filter', () => {
    expect(lobby.listTables({ minJackpot: 1_000 }, PLATFORM_CONTEXT)).toEqual([]);
  });
});
