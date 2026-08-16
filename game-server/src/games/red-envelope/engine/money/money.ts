/**
 * Represents an exact amount of virtual credits using integer smallest units.
 * Never use this to store decimal or floating-point approximations.
 *
 * Examples:
 *   100.00 credits -> 10000 units
 *   10 credits -> 1000 units
 */
export interface MoneyAmount {
  units: number;
}

/** Creates a valid MoneyAmount, ensuring it is an integer. */
export function toMoney(units: number): MoneyAmount {
  if (!Number.isInteger(units)) {
    throw new Error(`MoneyAmount must be an integer, got: ${units}`);
  }
  return { units };
}

/** Adds multiple amounts exactly. */
export function add(a: MoneyAmount, b: MoneyAmount): MoneyAmount {
  return toMoney(a.units + b.units);
}

/** Subtracts exact amounts. */
export function subtract(a: MoneyAmount, b: MoneyAmount): MoneyAmount {
  return toMoney(a.units - b.units);
}

/** Multiplies a money amount by a number (like a multiplier) and returns the exact fractional result. */
export function multiplyRaw(a: MoneyAmount, multiplier: number): number {
  return a.units * multiplier;
}
