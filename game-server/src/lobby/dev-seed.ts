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

  const tables: { id: string; gameId: GameId; stakes: number; players: number; jackpot: number }[] = [
    { id: 'tx-1', gameId: 'texas', stakes: $(2), players: 6, jackpot: $(52.14) },
    { id: 'tx-2', gameId: 'texas', stakes: $(20), players: 4, jackpot: $(128.43) },
    { id: 'tx-3', gameId: 'texas', stakes: $(1), players: 2, jackpot: $(8.9) },
    { id: 'sd-1', gameId: 'short-deck', stakes: $(5), players: 5, jackpot: $(12.5) },
    { id: 'om-1', gameId: 'omaha', stakes: $(2), players: 3, jackpot: $(9.05) },
    { id: 'ba-1', gameId: 'baccarat', stakes: $(5), players: 7, jackpot: $(4.2) },
    { id: 'nn-1', gameId: 'niu-niu', stakes: $(2), players: 5, jackpot: $(3.1) },
    { id: 'nn-2', gameId: 'niu-niu', stakes: $(1), players: 2, jackpot: $(0.9) },
    { id: 'ddz-1', gameId: 'dou-di-zhu', stakes: $(1), players: 3, jackpot: $(1.7) },
    { id: 'sz-1', gameId: 'san-zhang', stakes: $(2), players: 4, jackpot: $(2.05) },
    { id: 'rp-1', gameId: 'red-packet', stakes: $(0.5), players: 9, jackpot: $(6.4) },
    { id: 'cb-1', gameId: 'cowboy-beauty', stakes: $(1), players: 18, jackpot: $(5.3) },
  ];

  for (const table of tables) lobby.addTable(table);
  return lobby;
}
