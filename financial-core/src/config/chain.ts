/**
 * Chain configuration — network-agnostic, read at call time.
 *
 * The deposit path is identical on testnet and mainnet; only these values differ.
 * Launch = point them at mainnet, change no code:
 *
 *   TRON_API_URL          TronGrid base. Mainnet https://api.trongrid.io,
 *                         Nile testnet https://nile.trongrid.io (default: mainnet).
 *   TRON_API_KEY          TronGrid API key (optional — raises rate limits).
 *   USDT_TRC20_CONTRACT   The token contract the platform credits. Defaults to the
 *                         official mainnet USDT; on testnet, the faucet test-USDT
 *                         contract. A deposit of any other token is never credited.
 *   DEPOSIT_CONFIRMATIONS Confirmations required before crediting (default 20).
 *   DEPOSIT_POLL_MS       Watcher poll interval (default 15s).
 *
 * Functions, not constants, so a test (or a reconfigure) reads the current value
 * rather than one frozen at module load.
 */

/** Official mainnet USDT-TRC20 contract — the default when nothing is configured. */
export const MAINNET_USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

export function tronApiUrl(): string {
  return (process.env.TRON_API_URL ?? 'https://api.trongrid.io').replace(/\/+$/, '');
}

export function tronApiKey(): string {
  return process.env.TRON_API_KEY ?? '';
}

/**
 * The network as a player should see it on a receipt.
 *
 * Derived from the configured endpoint rather than hardcoded, so a testnet
 * deployment cannot email someone a receipt that reads like mainnet. A
 * deposit confirmation is a document people keep and forward to support;
 * "TRC-20" alone, sent from Nile, would have them believing real funds moved.
 */
export function networkLabel(): string {
  const url = tronApiUrl();
  if (url.includes('nile')) return 'TRON Nile testnet (TRC-20)';
  if (url.includes('shasta')) return 'TRON Shasta testnet (TRC-20)';
  return 'TRON (TRC-20)';
}

/** The token contract the platform currently accepts (mainnet USDT by default). */
export function usdtContract(): string {
  const v = process.env.USDT_TRC20_CONTRACT?.trim();
  return v && v.length > 0 ? v : MAINNET_USDT_TRC20;
}

export function requiredConfirmations(): number {
  const n = Number(process.env.DEPOSIT_CONFIRMATIONS ?? 20);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 20;
}

export function depositPollMs(): number {
  const n = Number(process.env.DEPOSIT_POLL_MS ?? 15_000);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 15_000;
}

/**
 * The hot-wallet private key withdrawals are paid FROM (hex). This is the ONLY online secret; keep
 * a small float on it and refill from cold storage. Empty ⇒ withdrawals cannot be broadcast — the
 * platform still takes deposits, but a payout stays REQUESTED/APPROVED until this is provisioned.
 */
export function hotWalletKey(): string {
  return (process.env.TRON_HOT_WALLET_KEY ?? '').trim();
}

/** fee_limit for a withdrawal transfer, in SUN (1 TRX = 1e6). Default 100 TRX. */
export function withdrawalFeeLimitSun(): number {
  const n = Number(process.env.WITHDRAWAL_FEE_LIMIT_SUN ?? 100_000_000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100_000_000;
}

/** Confirmations required before a withdrawal is finalized (CONFIRMED). Default = deposit depth. */
export function withdrawalConfirmations(): number {
  const raw = process.env.WITHDRAWAL_CONFIRMATIONS;
  if (raw === undefined) return requiredConfirmations();
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : requiredConfirmations();
}

/**
 * How long after a player CHANGES their withdrawal address before withdrawals to it are allowed
 * (spec §3.6: 48h cooldown, so a compromised account can't immediately redirect funds). Env-tunable
 * (ms) — set to 0 only in dev/tests where waiting 48h is impractical. Default 48h.
 */
export function withdrawalAddressCooldownMs(): number {
  const n = Number(process.env.WITHDRAWAL_ADDRESS_COOLDOWN_MS ?? 172_800_000);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 172_800_000;
}

/**
 * Sweep configuration — consolidating deposits from per-player addresses into one treasury.
 *
 * A deposit lands at the player's own address (derived from the PUBLIC xpub). To move it OUT, the
 * sweep must SIGN from that address, which needs its private key — derived from the account-level
 * extended PRIVATE key here. This is a hot secret, like the withdrawal key: on mainnet it belongs in
 * KMS/HSM, not an env var. Empty ⇒ sweeping is OFF and deposits simply stay put.
 *
 *   TRON_ACCOUNT_XPRV        m/44'/195'/0' extended private key (SECRET; empty ⇒ sweep off)
 *   TREASURY_SWEEP_ADDRESS   where swept USDT is collected (empty ⇒ sweep off)
 *   SWEEP_GAS_WALLET_KEY     pays the TRX gas dripped into an address before its USDT can move
 *                            (defaults to the hot wallet, which already holds TRX)
 *   SWEEP_MIN_USDT           don't sweep dust below this (default 1 USDT)
 *   SWEEP_GAS_SUN            TRX to drip per address, in SUN (default 30 TRX)
 *   SWEEP_POLL_MS            scan interval (default 60s)
 *   SWEEP_COOLDOWN_MS        per-address quiet time after an action, so an in-flight tx is not
 *                            double-sent before it confirms (default 5 min)
 */
export function accountXprv(): string {
  return (process.env.TRON_ACCOUNT_XPRV ?? '').trim();
}

export function treasurySweepAddress(): string {
  return (process.env.TREASURY_SWEEP_ADDRESS ?? '').trim();
}

export function sweepGasWalletKey(): string {
  return (process.env.SWEEP_GAS_WALLET_KEY ?? process.env.TRON_HOT_WALLET_KEY ?? '').trim();
}

/** Minimum USDT (decimal string) worth sweeping — below this the gas costs more than it collects. */
export function sweepMinUsdt(): string {
  const v = process.env.SWEEP_MIN_USDT?.trim();
  return v && v.length > 0 ? v : '1';
}

export function sweepGasSun(): number {
  const n = Number(process.env.SWEEP_GAS_SUN ?? 30_000_000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30_000_000;
}

export function sweepPollMs(): number {
  const n = Number(process.env.SWEEP_POLL_MS ?? 60_000);
  return Number.isFinite(n) && n >= 5000 ? Math.floor(n) : 60_000;
}

export function sweepCooldownMs(): number {
  const n = Number(process.env.SWEEP_COOLDOWN_MS ?? 300_000);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 300_000;
}

/** Sweeping runs only when both the signing key and the destination are configured. */
export function sweepEnabled(): boolean {
  return accountXprv().length > 0 && treasurySweepAddress().length > 0;
}
