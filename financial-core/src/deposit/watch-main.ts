import { loadConfig } from '../config/env';
import { connectDb, disconnectDb } from '../db/connection';
import { runWatcher } from './deposit-watcher';
import { runWithdrawalWatcher } from '../withdrawal/withdrawal-watcher';
import { runSweeper } from './sweep';
import { tronGridSweepChain } from './sweep-chain';
import { hotWalletKey } from '../config/chain';
import { installGatewayRecipientFromEnv } from '../notifications/email/gateway-recipient';
import {
  tronApiUrl,
  usdtContract,
  requiredConfirmations,
  depositPollMs,
  sweepEnabled,
  treasurySweepAddress,
  sweepPollMs,
} from '../config/chain';

/**
 * Deposit-watcher process — the COMPILED entry point (this lives in `src/` so it ships in `dist/`,
 * unlike `scripts/deposit-watcher.ts`, which runs under ts-node for local dev only).
 *
 * Runs as its own dyno (Procfile `worker`) alongside the Financial Core `web` dyno: it connects to
 * the same database, polls the chain for confirmed deposits, and credits them through the money
 * path. Separate process so a chain hiccup never touches the API. Deploy note: enable the `worker`
 * dyno on the FC app (Resources → worker → scale to 1) or deposits never auto-credit.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  await connectDb({ uri: cfg.MONGO_URI, tls: cfg.MONGO_TLS });

  console.log('[deposit-watcher] started');
  console.log(`  RPC      ${tronApiUrl()}`);
  console.log(`  token    ${usdtContract()}`);
  console.log(`  confirms ${requiredConfirmations()}   poll ${depositPollMs()}ms`);

  // The dyno that credits deposits is the dyno that must be able to email the
  // receipt. This was wired only in src/index.ts (the web dyno), so on the
  // deployed path every real deposit credited silently and mailed nobody.
  const mailLive = installGatewayRecipientFromEnv(cfg.INTERNAL_API_SECRET);
  console.log(`  email    ${mailLive ? 'gateway lookup on' : 'OFF (GATEWAY_URL unset)'}`);

  const deposits = runWatcher();
  // Same dyno also finalizes broadcast withdrawals (→ CONFIRMED) once they're on-chain-final.
  const withdrawals = runWithdrawalWatcher();
  console.log(`  withdrawals  confirmation watcher on (hot wallet ${hotWalletKey() ? 'set' : 'NOT set'})`);

  // …and consolidates deposits into the treasury, but only when configured — sweeping needs the
  // account xprv (a hot secret) + a destination, so it stays OFF until both are set.
  const sweeper = sweepEnabled() ? runSweeper(tronGridSweepChain()) : null;
  console.log(
    sweeper
      ? `  sweeper      on → treasury ${treasurySweepAddress()}   poll ${sweepPollMs()}ms`
      : '  sweeper      OFF (set TRON_ACCOUNT_XPRV + TREASURY_SWEEP_ADDRESS to enable)',
  );

  const shutdown = (): void => {
    deposits.stop();
    withdrawals.stop();
    sweeper?.stop();
    void disconnectDb().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[deposit-watcher] failed to start:', err);
  process.exit(1);
});
