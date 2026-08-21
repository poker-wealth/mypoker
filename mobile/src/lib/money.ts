/**
 * Formatting money for display. Formatting only.
 *
 * Mirrors the half of `frontend/src/lib/money.ts` the table actually uses. Nothing here computes,
 * converts or rounds a balance for any purpose other than drawing it: the app never works out what
 * a player has, it renders what the server sent. The iron rule is that money moves through
 * `transfer()` in financial-core, and a formatter is the furthest thing from that — keep it that
 * way, and do not grow arithmetic in this file.
 */

/** The table currency mark. Chips, not USDT — the two are 100x apart and must never be confused. */
const SYMBOL = '₮';

/**
 * Table chips — the live room's units, NOT micro-USD.
 *
 * Blinds are 10/20 and buy-ins are in the hundreds, so these are plain integers and rounding one
 * for display cannot lose value that mattered.
 */
export const chips = (amount: number): string =>
  `${SYMBOL}${Math.round(amount).toLocaleString()}`;
