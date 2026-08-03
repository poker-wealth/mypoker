import { Decimal128 } from 'bson';

/**
 * Money — the ONLY representation of a fund amount in the Financial Core.
 *
 * Iron rule (FairPlay spec §3.2 / M1 Remediation): all amounts are exact integers.
 * NO JavaScript floating-point number ever touches a balance or ledger amount.
 *
 * Internal representation: a `bigint` count of MICRO-UNITS.
 *   1 USDT = 1_000_000 micro-units (6 decimal places — matches USDT-TRC20 on-chain precision,
 *   and subsumes the spec's "cents" since cents = 10_000 micro-units).
 *
 * Persistence: Decimal128 (exact decimal, native to MongoDB). Convert at the storage boundary
 * only — never compute in Decimal128 or number.
 *
 * Immutable value object. Every operation returns a new Money.
 */

const SCALE = 6; // decimal places
const SCALE_FACTOR = 1_000_000n; // 10 ** 6

export class Money {
  /** Count of micro-units. Can be negative only for internal deltas — balances are validated elsewhere. */
  private readonly micro: bigint;

  private constructor(micro: bigint) {
    this.micro = micro;
  }

  // ─── Constructors ───────────────────────────────────────────────────────────

  static readonly ZERO = new Money(0n);

  /** From a raw micro-unit count (the canonical minor unit). */
  static fromMicros(micro: bigint): Money {
    return new Money(micro);
  }

  /**
   * From a decimal string like "12.5" or "0.000001" or "-3.25".
   * Rejects anything finer than 6 decimal places (no silent rounding of money).
   */
  static fromDecimalString(value: string): Money {
    const trimmed = value.trim();
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
    if (!match) {
      throw new RangeError(`Money.fromDecimalString: invalid decimal "${value}"`);
    }
    const sign = match[1] === '-' ? -1n : 1n;
    const whole = match[2] ?? '0';
    const frac = match[3] ?? '';
    if (frac.length > SCALE) {
      throw new RangeError(
        `Money.fromDecimalString: "${value}" has more than ${SCALE} decimal places`,
      );
    }
    const fracPadded = frac.padEnd(SCALE, '0');
    const micro = sign * (BigInt(whole) * SCALE_FACTOR + BigInt(fracPadded || '0'));
    return new Money(micro);
  }

  /** From a Mongo Decimal128 (storage boundary). Exact; rejects sub-micro precision. */
  static fromDecimal128(value: Decimal128): Money {
    return Money.fromDecimalString(value.toString());
  }

  // ─── Accessors ──────────────────────────────────────────────────────────────

  /** Raw micro-unit count. Use this for storage-as-bigint or exact transport. */
  toMicros(): bigint {
    return this.micro;
  }

  /** Canonical decimal string, always exactly 6 dp (e.g. "12.500000"). Safe for display/transport. */
  toString(): string {
    const neg = this.micro < 0n;
    const abs = neg ? -this.micro : this.micro;
    const whole = abs / SCALE_FACTOR;
    const frac = (abs % SCALE_FACTOR).toString().padStart(SCALE, '0');
    return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
  }

  /** Decimal128 for MongoDB persistence. */
  toDecimal128(): Decimal128 {
    return Decimal128.fromString(this.toString());
  }

  toJSON(): string {
    return this.toString();
  }

  // ─── Arithmetic (exact, integer) ─────────────────────────────────────────────

  add(other: Money): Money {
    return new Money(this.micro + other.micro);
  }

  subtract(other: Money): Money {
    return new Money(this.micro - other.micro);
  }

  negate(): Money {
    return new Money(-this.micro);
  }

  /**
   * Multiply by a count of basis points (1 bp = 0.01%), flooring toward zero to whole micro-units.
   * Used for rake / jackpot injection (e.g. 50 bp = 0.5%). Deterministic; remainder is dropped here —
   * exact-sum splitting (so 20/30/25/25 reconcile to the penny) is handled by `splitByBasisPoints`.
   */
  mulBasisPoints(bp: bigint): Money {
    // micro * bp / 10_000, truncated toward zero.
    return new Money((this.micro * bp) / 10_000n);
  }

  // ─── Comparisons / predicates ────────────────────────────────────────────────

  isZero(): boolean {
    return this.micro === 0n;
  }

  isNegative(): boolean {
    return this.micro < 0n;
  }

  isPositive(): boolean {
    return this.micro > 0n;
  }

  equals(other: Money): boolean {
    return this.micro === other.micro;
  }

  greaterThan(other: Money): boolean {
    return this.micro > other.micro;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.micro >= other.micro;
  }

  lessThan(other: Money): boolean {
    return this.micro < other.micro;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.micro <= other.micro;
  }

  // ─── Aggregates ───────────────────────────────────────────────────────────────

  static sum(amounts: readonly Money[]): Money {
    let acc = 0n;
    for (const m of amounts) acc += m.micro;
    return new Money(acc);
  }
}
