import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadConfig } from './config/env';
import { connectDb, disconnectDb } from './db/connection';
import { createApp } from './http/app';
import { installTelegramAlertsFromEnv } from './lib/telegram-alert';

/**
 * FairPlay Financial Core — production entrypoint.
 *
 * loadConfig (validate env) → connect to the configured MongoDB → start the HTTP server →
 * shut down cleanly on signal. This is the path that runs in deployment (`npm run dev` / built
 * `dist/index.js`), as opposed to the in-memory dev/test harness.
 */

export interface RunningServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

/** Boot the service against the configured environment. Exported so tests can drive the real path. */
export async function startServer(): Promise<RunningServer> {
  const config = loadConfig();
  await connectDb({ uri: config.MONGO_URI, tls: config.MONGO_TLS });

  // Route ops alerts (circuit-breaker trips, illegal-flow alarms) to Telegram when the bot is
  // configured; otherwise the stderr default stands. Logged so a deploy makes the live channel obvious.
  const alertsLive = installTelegramAlertsFromEnv();
  console.log(`[ops-alerts] delivery: ${alertsLive ? 'telegram' : 'stderr (TG_BOT_TOKEN/TG_OPS_CHAT_ID unset)'}`);

  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(config.PORT, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await disconnectDb();
  };

  return { server, port, close };
}

if (require.main === module) {
  startServer()
    .then(({ port, close }) => {
      console.log(`FairPlay Financial Core listening on :${port}`);
      const shutdown = (signal: string): void => {
        console.log(`\n${signal} received — shutting down…`);
        close()
          .then(() => process.exit(0))
          .catch((err) => {
            console.error('error during shutdown', err);
            process.exit(1);
          });
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((err: unknown) => {
      console.error('Financial Core failed to start:\n', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
