import { LobbyService } from './lobby-service';
import type { GameId } from './game-catalog';

/**
 * A believable lobby to develop against.
 *
 * PLACEHOLDER. In production the LobbyService must be the instance the game loop
 * owns and mutates as tables fill, empty and accrue jackpot — the lobby is live
 * state, not a fixture. These numbers never change.
 *
 * It lives here rather than in either caller because both the gateway and the
 * serverless lobby function need it, and two copies of "what the lobby looks
 * like" would drift into showing different tables depending on which one
 * answered.
 */
export function seedLobby(): LobbyService {
  const lobby = new LobbyService();
  const $ = (dollars: number): number => Math.round(dollars * 1_000_000);

  const tables: {
    id: string;
    gameId: GameId;
    stakes: number;
    players: number;
    jackpot: number;
    buyInBB: number;
    tableType?: 'PLATFORM' | 'LEAGUE';
    leagueId?: string;
  }[] = [
    // buyInBB varies per table on purpose: a lobby where every row reads 40BB
    // tells a player nothing, and the column exists precisely so deep tables can
    // be told from shallow ones at a glance.
    { id: 'tx-1', gameId: 'texas', stakes: $(2), players: 6, jackpot: $(52.14), buyInBB: 42 },
    { id: 'tx-2', gameId: 'texas', stakes: $(20), players: 4, jackpot: $(128.43), buyInBB: 88 },
    { id: 'tx-3', gameId: 'texas', stakes: $(1), players: 2, jackpot: $(8.9), buyInBB: 38 },
    { id: 'sd-1', gameId: 'short-deck', stakes: $(5), players: 5, jackpot: $(12.5), buyInBB: 112 },
    { id: 'om-1', gameId: 'omaha', stakes: $(2), players: 3, jackpot: $(9.05), buyInBB: 60 },
    { id: 'ba-1', gameId: 'baccarat', stakes: $(5), players: 7, jackpot: $(4.2), buyInBB: 40 },
    { id: 'nn-1', gameId: 'niu-niu', stakes: $(2), players: 5, jackpot: $(3.1), buyInBB: 50 },
    { id: 'nn-2', gameId: 'niu-niu', stakes: $(1), players: 2, jackpot: $(0.9), buyInBB: 30 },
    { id: 'ddz-1', gameId: 'dou-di-zhu', stakes: $(1), players: 3, jackpot: $(1.7), buyInBB: 25 },
    { id: 'sz-1', gameId: 'san-zhang', stakes: $(2), players: 4, jackpot: $(2.05), buyInBB: 40 },
    { id: 'rp-1', gameId: 'red-packet', stakes: $(0.5), players: 9, jackpot: $(6.4), buyInBB: 20 },
    { id: 'cb-1', gameId: 'cowboy-beauty', stakes: $(1), players: 18, jackpot: $(5.3), buyInBB: 20 },
    // Deep high-stakes tables, so the stake filter has something above 25/50 to
    // find and the buy-in column has a genuine range.
    { id: 'tx-4', gameId: 'texas', stakes: $(50), players: 6, jackpot: $(890.2), buyInBB: 240 },
    { id: 'tx-5', gameId: 'texas', stakes: $(200), players: 9, jackpot: $(2140.75), buyInBB: 512 },
    // League private rooms. These must NOT appear in the public lobby — seeding
    // them is what makes that testable by hand rather than only in a unit test,
    // and an empty set was how the isolation went unverified for so long.
    {
      id: 'lg-macau-1',
      gameId: 'texas',
      stakes: $(10),
      players: 5,
      jackpot: $(340.5),
      buyInBB: 100,
      tableType: 'LEAGUE',
      leagueId: 'league-macau',
    },
    {
      id: 'lg-xuzhou-1',
      gameId: 'short-deck',
      stakes: $(25),
      players: 4,
      jackpot: $(112.8),
      buyInBB: 120,
      tableType: 'LEAGUE',
      leagueId: 'league-xuzhou',
    },
  ];

  for (const table of tables) lobby.addTable(table);
  return lobby;
}
