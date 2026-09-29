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
import { seedDefaultAdmin } from '../auth/user-store';
import type { TableHub } from '../live/table-hub';

loadDotenv();

const config = loadConfig();

// Connect the gateway's own database (the user store) before accepting requests —
// web sign-in needs it, and failing loudly on boot beats 500s at login time.
connectDb(config.mongoUri, config.mongoTls)
  .then(async () => {
    // Ensure a platform administrator exists before serving — otherwise the
    // admin panel is unreachable (nothing else mints an ops token). Idempotent:
    // a no-op once any ops account exists. Failing here is non-fatal — the
    // player app must still come up — so a seed error is logged, not thrown.
    await seedDefaultAdmin().catch((err: unknown) =>
      console.error('[admin] default-admin seed failed:', err instanceof Error ? err.message : err),
    );

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

    // Graceful shutdown (BUG-07). This is the production entry point — `Procfile` runs
    // `npm start` → `node dist/gateway/server.js` — and it had no SIGTERM/SIGINT hook at all before
    // this: a platform stop (deploy, dyno restart, scale-down) killed the process outright, and
    // `TableHub.close()` was never even reached. `dispose()` alone was never enough anyway — it
    // stops timers, it does not release a seat — so every seated stack, at every table, stayed
    // locked in FC until something else happened to stand that player up. `hub.drain()` (added this
    // change) releases every one of them first.
    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals): void => {
      if (shuttingDown) {
        // A second stop signal mid-drain (D7, BUG-07 follow-up): the platform is done waiting —
        // exit now rather than risk racing whatever drain()/close() is still in flight. This used to
        // silently no-op a repeat signal, which meant an operator's second Ctrl-C (or the platform's
        // own SIGTERM-then-SIGKILL-but-something-forwarded-SIGTERM-twice) just sat there.
        console.error(`\n  [shutdown] ${signal} received again while draining — exiting immediately\n`);
        process.exit(1);
      }
      shuttingDown = true;
      console.log(`\n  [shutdown] ${signal} received — draining live tables before exit\n`);

      // Heroku's dyno shutdown window (Procfile: `web: npm start`) is a fixed 30s from SIGTERM to
      // SIGKILL and is not configurable — see the DEPLOY.md note added alongside this. 25s leaves 5s
      // of margin for this timer to fire, log, and hand off to process.exit before that happens.
      const hardExit = setTimeout(() => {
        console.error('[shutdown] drain/close did not finish within 25s — exiting anyway');
        process.exit(1);
      }, 25_000);
      hardExit.unref();

      // Stop accepting new HTTP/WS connections (a new WS upgrade is an HTTP request on this same
      // server) before draining — nobody new should be able to sit down while the tables are being
      // told to empty out. Already-open sockets are unaffected until the hub itself closes them.
      server.close((err) => {
        if (err) console.error('[shutdown] http server close error:', err);
      });

      // Exit 1 rather than 0 (D7, BUG-07 follow-up) if any seat, at any table, failed to release —
      // a "successful" shutdown that actually left chips locked in FC must not look the same to the
      // platform/ops as a clean one.
      let hadFailures = false;
      void (hub ? hub.drain() : Promise.resolve(0))
        .catch((err: unknown) => {
          console.error('[shutdown] hub.drain() failed:', err);
          hadFailures = true;
          return 0; // still fall through to hub.close() below
        })
        .then((failures) => {
          if (failures > 0) hadFailures = true;
          return hub?.close();
        })
        .catch((err: unknown) => {
          console.error('[shutdown] hub.close() failed:', err);
          hadFailures = true;
        })
        .then(() => {
          clearTimeout(hardExit);
          process.exit(hadFailures ? 1 : 0);
        });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err: unknown) => {
    console.error('gateway failed to start — database:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
