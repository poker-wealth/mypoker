import { loadConfig } from '../src/config/env';
import { connectDb, disconnectDb } from '../src/db/connection';
import { runWatcher } from '../src/deposit/deposit-watcher';
import { tronApiUrl, usdtContract, requiredConfirmations, depositPollMs } from '../src/config/chain';

/**
 * Deposit watcher process. Connects to the same database as the Financial Core
 * and polls the chain for confirmed deposits, crediting them through the money
 * path. Run alongside the Financial Core (a separate process so a chain hiccup
 * never touches the API).
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  await connectDb({ uri: cfg.MONGO_URI, tls: cfg.MONGO_TLS });

  console.log('[deposit-watcher] started');
  console.log(`  RPC      ${tronApiUrl()}`);
  console.log(`  token    ${usdtContract()}`);
  console.log(`  confirms ${requiredConfirmations()}   poll ${depositPollMs()}ms`);

  const watcher = runWatcher();

  const shutdown = (): void => {
    watcher.stop();
    void disconnectDb().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[deposit-watcher] failed to start:', err);
  process.exit(1);
});
