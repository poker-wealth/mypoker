/**
 * Chip ↔ USDT conversion — the single unit boundary between the poker engine and the money core.
 *
 * The engine deals in integer "chips"; the Financial Core deals in USDT decimal strings. The v5.9
 * spec fixes the accounting unit at cents ("BIGINT, unit: cents"), so one chip is one cent:
 *
 *     1 chip = $0.01
 *
 * All arithmetic is exact (BigInt / string), never float — iron rule: no floating point on money.
 * This is the ONLY place the two units meet; the room, the games and the ledger each stay in their
 * own unit on either side of it.
 */

const CENTS_PER_USDT = 100n;

/** Integer chip string ("2000") → USDT decimal string ("20.00"). */
export function chipsToUsdt(chips: string): string {
  const n = parseChips(chips);
  const whole = n / CENTS_PER_USDT;
  const cents = n % CENTS_PER_USDT;
  return `${whole.toString()}.${cents.toString().padStart(2, '0')}`;
}

/** USDT decimal string ("20", "20.00", "500.000000", "0.05") → whole chips (cents), floored. */
export function usdtToChips(usdt: string): number {
  const trimmed = usdt.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`bad USDT amount: ${usdt}`);
  const [intPart, fracPart = ''] = trimmed.split('.');
  // Truncate to cents (floor): you can only seat with whole cents, even though the ledger holds
  // deposits to six decimals.
  const cents = BigInt(intPart!) * CENTS_PER_USDT + BigInt(`${fracPart}00`.slice(0, 2));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`balance too large to seat: ${usdt}`);
  return Number(cents);
}

function parseChips(chips: string): bigint {
  const trimmed = chips.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`chips must be a non-negative integer: ${chips}`);
  return BigInt(trimmed);
}
