/**
 * Currency formatting — one home for it.
 *
 * This mirrors `frontend/src/lib/money.ts`, and exists for the reason that file
 * documents: before it, the Mini App had fifteen call sites in three different
 * shapes, and the same balance read `₮1,234.5` on one screen and `₮1,234.50` on
 * the next. This app had started down the same path — `money` in VipScreen,
 * `moneyFromDecimal` in both DataScreen and ProfileScreen, and a fourth
 * variant in NotificationsScreen.
 *
 * Two units exist and confusing them is the expensive mistake:
 *
 *   micro-USD — what financial-core sends as a number. 1 USD = 1,000,000.
 *   decimal   — what financial-core sends as a string, e.g. '12.500000'.
 *
 * Separate functions with separate names, deliberately. A single `format(n)`
 * is what lets a micro-unit value render as `9,710,157,500` where `9,710.16`
 * was meant — a bug this project has already shipped once, on the VIP screen.
 */

/** The platform's currency mark (USDT). Never write this inline. */
export const SYMBOL = '₮';

export interface MoneyOptions {
  decimals?: number;
  /** Prefix a `+` on positive values. For deltas, not balances. */
  sign?: boolean;
  /**
   * Pass `false` when the surrounding TRANSLATION already carries the mark.
   * Locales place it differently, so the template owns it and the formatter
   * must not add a second one — this is what caused the double-₮ on VIP.
   */
  symbol?: boolean;
}

function render(value: number, options: MoneyOptions): string {
  const { decimals = 2, sign = false, symbol = true } = options;
  // The minus goes OUTSIDE the currency mark: -₮1.50, not ₮-1.50. Every
  // locale-aware formatter does it that way, and a losing round on the Data
  // screen is the case that made it visible.
  const prefix = value < 0 ? '-' : sign && value > 0 ? '+' : '';
  return `${prefix}${symbol ? SYMBOL : ''}${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Money for display, from micro-USD integers.
 *
 * `micros` widened to allow `null`/`undefined` because callers read this
 * straight off API payloads, and a missing or not-yet-loaded field is a real
 * shape those payloads take. Non-finite input (missing, null, undefined,
 * NaN, Infinity) renders as an em dash: this project's rule is that an
 * absent figure must never be confused with a real one, and `₮0` is itself a
 * claim ("this balance is zero") the caller has no basis to make. An em dash
 * says "not shown", not "zero" — matching how the rest of this codebase
 * already handles an unknown balance (see WalletScreen's `available` prop).
 */
export function money(micros: number | null | undefined, options: MoneyOptions = {}): string {
  if (typeof micros !== 'number' || !Number.isFinite(micros)) return '—';
  return render(micros / 1_000_000, options);
}

/**
 * Money for display, from a decimal string ('12.500000').
 *
 * Returns the raw input if it is not a number: showing the server's own odd
 * value is honest, where `NaN` in a currency slot is not.
 */
export function moneyFromDecimal(value: string, options: MoneyOptions = {}): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return render(n, options);
}
