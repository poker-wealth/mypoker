/**
 * TRC-20 USDT deposit rules (FairPlay §3.7).
 *
 * Two hard gates before any deposit is credited:
 *   1. The transfer must come from the OFFICIAL USDT contract — any other contract is ignored
 *      (logged + player notified, but never credited).
 *   2. The transaction must have ≥ 20 block confirmations — mempool / unconfirmed is NEVER credited.
 */

/** The one and only USDT-TRC20 contract address the platform accepts. */
export const OFFICIAL_USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** Block confirmations required before a deposit is credited (~60 seconds on TRON). */
export const REQUIRED_CONFIRMATIONS = 20;

export function isOfficialContract(contractAddress: string): boolean {
  return contractAddress === OFFICIAL_USDT_TRC20_CONTRACT;
}

export function isConfirmed(confirmations: number): boolean {
  return confirmations >= REQUIRED_CONFIRMATIONS;
}
