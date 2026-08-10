import { MAINNET_USDT_TRC20, usdtContract, requiredConfirmations } from '../config/chain';

/**
 * TRC-20 USDT deposit rules (FairPlay §3.7).
 *
 * Two hard gates before any deposit is credited:
 *   1. The transfer must come from the accepted USDT contract — any other contract is ignored
 *      (logged + player notified, but never credited).
 *   2. The transaction must have ≥ the required block confirmations — mempool / unconfirmed is
 *      NEVER credited.
 *
 * The accepted contract and confirmation count are configuration (see config/chain.ts): mainnet
 * USDT and 20 by default, a testnet faucet token and a lower count when the env says so. Same
 * rules, different network — launch flips the env, not the code.
 */

/** The official mainnet USDT-TRC20 contract (the default accepted contract). */
export const OFFICIAL_USDT_TRC20_CONTRACT = MAINNET_USDT_TRC20;

/** Default confirmations (~60s on TRON). Overridden by DEPOSIT_CONFIRMATIONS. */
export const REQUIRED_CONFIRMATIONS = 20;

export function isOfficialContract(contractAddress: string): boolean {
  return contractAddress === usdtContract();
}

export function isConfirmed(confirmations: number): boolean {
  return confirmations >= requiredConfirmations();
}
