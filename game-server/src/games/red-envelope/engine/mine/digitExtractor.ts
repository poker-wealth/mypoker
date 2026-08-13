import type { MoneyAmount } from '../money/money';

export type MineDigitMode = 'LAST_WHOLE_DIGIT' | 'LAST_DECIMAL_DIGIT';

/**
 * Extracts the digit to check from a MoneyAmount based on the mode.
 * 
 * Assuming 1 unit = 0.01 display currency (like $0.01).
 * 
 * - LAST_WHOLE_DIGIT: If amount is 1234 units ($12.34), the last whole digit is 2.
 *   Calculated as (units / 100) % 10 => 12 % 10 = 2.
 * 
 * - LAST_DECIMAL_DIGIT: If amount is 1234 units ($12.34), the last decimal digit is 4.
 *   Calculated as units % 10 => 1234 % 10 = 4.
 */
export function extractDigit(amount: MoneyAmount, mode: MineDigitMode, smallestUnitScale: number = 100): number {
  if (mode === 'LAST_DECIMAL_DIGIT') {
    return amount.units % 10;
  }
  
  if (mode === 'LAST_WHOLE_DIGIT') {
    // Drop the decimal part (e.g., the cents)
    const wholeUnits = Math.floor(amount.units / smallestUnitScale);
    return wholeUnits % 10;
  }
  
  throw new Error(`Unknown digit mode: ${mode}`);
}
