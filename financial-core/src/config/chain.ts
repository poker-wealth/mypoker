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
