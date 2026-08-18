/**
 * Currency and number formatting — one home for it (Phase E #7).
 *
 * Before this there were fifteen call sites across three different
 * `toLocaleString` shapes, each hardcoding the ₮ symbol: some showed two
 * decimals, some none, some whatever the locale defaulted to. The same balance
 * could read ₮1,234.5 on one screen and ₮1,234.50 on the next.
 *
 * Two units exist in this app and confusing them is the expensive mistake:
 *
 *   micro-USD  — everything financial-core sends. 1 USD = 1,000,000.
 *   chips      — the live table's own units (blinds 10/20, buy-ins in hundreds).
 *
 * They are separate functions with separate names on purpose. A jackpot
 * rendered with the wrong one showed 0.00 for a 2,000-chip win during Phase C,
 * which is exactly the class of bug a shared `format(n)` invites.
 */

/** The platform's currency mark (USDT). Never write this inline. */
export const SYMBOL = '₮';

/**
 * Money for display, from micro-USD.
 *
 * Two decimals by default because that is what a currency looks like; a balance
 * that renders ₮12.5 reads like a typo next to ₮12.50.
 */
export function money(micros: number, options: { decimals?: number; sign?: boolean } = {}): string {
  const { decimals = 2, sign = false } = options;
  const value = micros / 1_000_000;
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${SYMBOL}${value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Money from a decimal string, as financial-core sends it ('12.500000').
 *
 * Kept distinct from `money()` rather than parsed at the call site, so nobody
 * has to remember whether a given field arrived as a number or a string.
 */
export function moneyFromDecimal(value: string, options?: { decimals?: number; sign?: boolean }): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value; // never show NaN where a balance goes
  return money(Math.round(n * 1_000_000), options);
}

/**
 * Table chips — the live room's units, NOT micro-USD.
 *
 * No decimals: chip counts are whole, and a stack reading 2,000.00 looks like a
 * currency the table does not use.
 */
export const chips = (amount: number): string => `${SYMBOL}${Math.round(amount).toLocaleString()}`;

/** Large figures where the cents are noise — jackpot headlines, volume totals. */
export const compactMoney = (micros: number): string => money(micros, { decimals: 0 });

/** A plain count: hands, rounds, players, members. */
export const count = (n: number): string => n.toLocaleString();

/**
 * A percentage from a server string ('52.3'), or an em dash when there is none.
 *
 * Null is deliberately not 0%: a player who has never played has no win rate,
 * and 0% reads as "you lose every hand".
 */
export const percent = (value: string | null, decimals = 1): string =>
  value === null ? '—' : `${Number(value).toFixed(decimals)}%`;

/**
 * The NUMBER part of a ledger decimal string, formatted for display — no symbol.
 *
 * For strings that already sit inside a translated sentence carrying its own
 * currency mark, like `notifications.deposit`: "Deposit of ₮{{amount}} credited".
 * financial-core sends six decimals ('500.000000') because that is the ledger's
 * precision; showing a player "₮500.000000" reads like a bug in the amount
 * rather than a faithful figure, and prepending another ₮ via moneyFromDecimal
 * would render "₮₮500.00".
 *
 * Display only — the ledger string remains the truth, and nothing here is ever
 * fed back into a calculation.
 */
export function amountOnly(value: string, decimals = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
