/**
 * Gateway entrypoint.
 *
 *   npm run gateway
 *
 * Reads .env, boots the HTTP app, and reports what it's configured with — the
 * summary is deliberately printed because a gateway that starts with no bot token
 * or with the dev bypass on is a thing you want to notice immediately.
 */
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from './config';
import { createGatewayApp } from './app';
import { LobbyService, type GameId } from '../lobby';

loadDotenv();

/**
 * Seed tables so the lobby endpoints return something to develop against.
 *
 * PLACEHOLDER. In production this LobbyService instance must be the one the game
 * loop owns and mutates as tables fill, empty and accrue jackpot — the lobby is
 * live state, not a fixture. Wiring the gateway to that instance is part of
 * replacing the demo engine with the real server feed; until then these are
 * plausible numbers that never change.
 */
function seedLobby(): LobbyService {
  const lobby = new LobbyService();
  const $ = (dollars: number): number => dollars * 1_000_000;
  const tables: { id: string; gameId: GameId; stakes: number; players: number; jackpot: number }[] = [
    { id: 'tx-1', gameId: 'texas', stakes: $(2), players: 6, jackpot: $(52.14) },
    { id: 'tx-2', gameId: 'texas', stakes: $(20), players: 4, jackpot: $(128.43) },
    { id: 'tx-3', gameId: 'texas', stakes: $(1), players: 2, jackpot: $(8.9) },
    { id: 'sd-1', gameId: 'short-deck', stakes: $(5), players: 5, jackpot: $(12.5) },
    { id: 'om-1', gameId: 'omaha', stakes: $(2), players: 3, jackpot: $(9.05) },
    { id: 'ba-1', gameId: 'baccarat', stakes: $(5), players: 7, jackpot: $(4.2) },
    { id: 'nn-1', gameId: 'niu-niu', stakes: $(2), players: 5, jackpot: $(3.1) },
    { id: 'ddz-1', gameId: 'dou-di-zhu', stakes: $(1), players: 3, jackpot: $(1.7) },
    { id: 'sz-1', gameId: 'san-zhang', stakes: $(2), players: 4, jackpot: $(2.05) },
    { id: 'rp-1', gameId: 'red-packet', stakes: $(0.5), players: 9, jackpot: $(6.4) },
  ];
  for (const table of tables) lobby.addTable(table);
  return lobby;
}

const config = loadConfig();
const app = createGatewayApp(config, seedLobby());

app.listen(config.port, () => {
  console.log(`\n  FairPlay gateway — http://localhost:${config.port}\n`);
  console.log(`  telegram login   ${config.botToken ? 'enabled' : 'DISABLED (no bot token)'}`);
  console.log(`  dev bypass       ${config.devAuthBypass ? 'ON — do not deploy this' : 'off'}`);
  console.log(`  financial core   ${config.financialCoreUrl}`);
  console.log(`  cors origins     ${config.corsOrigins.join(', ') || '(none — same-origin only)'}\n`);
});
