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
import { createServer } from 'node:http';
import { loadConfig } from './config';
import { createGatewayApp } from './app';
import { LobbyService } from '../lobby';
import { connectDb } from '../db/connection';
import type { TableHub } from '../live/table-hub';

loadDotenv();

const config = loadConfig();

// Connect the gateway's own database (the user store) before accepting requests —
// web sign-in needs it, and failing loudly on boot beats 500s at login time.
connectDb(config.mongoUri, config.mongoTls)
  .then(() => {
    // An EMPTY lobby, filled from the live hub inside createGatewayApp.
    //
    // It used to be seedLobby() — a file that calls itself a PLACEHOLDER and says the lobby
    // "must be the instance the game loop owns". There was no dev guard, so that placeholder
    // was the production lobby: invented tables, at invented stakes, that no room answered to.
    // Anyone tapping one got "unknown table". The lobby now lists only rooms that exist, which
    // means it is allowed to be short — see src/lobby/live-sync.ts.
    const app = createGatewayApp(config, new LobbyService());
    // One process, one origin: the HTTP API and the game socket share this server. The live-table
    // hub (with the real-money rail) was built inside createGatewayApp and left on app.locals; here
    // we attach its WebSocket to the same http server at /ws.
    const server = createServer(app);
    const hub = app.locals.tableHub as TableHub | undefined;
    if (hub) hub.attachTo(server, '/ws');

    server.listen(config.port, () => {
      console.log(`\n  FairPlay gateway — http://localhost:${config.port}\n`);
      console.log(`  telegram login   ${config.botToken ? 'enabled' : 'DISABLED (no bot token)'}`);
      console.log(`  dev bypass       ${config.devAuthBypass ? 'ON — do not deploy this' : 'off'}`);
      console.log(`  financial core   ${config.financialCoreUrl}`);
      console.log(`  user store       connected`);
      console.log(`  live tables      ${hub ? `on — ws /ws (${hub.tables().length} open)` : 'off (no FC secret)'}`);
      console.log(`  cors origins     ${config.corsOrigins.join(', ') || '(none — same-origin only)'}\n`);
    });
  })
  .catch((err: unknown) => {
    console.error('gateway failed to start — database:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
