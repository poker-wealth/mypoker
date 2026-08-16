import type { MoneyAmount } from '../money/money';
import { type MineDigitMode, extractDigit } from './digitExtractor';

export interface MineEvaluation {
  checkedDigit: number;
  mineNumber: number;
  mineHit: boolean;
}

/**
 * Evaluates whether a claimed packet hits the mine.
 */
export function evaluateMine(
  amount: MoneyAmount,
  mineNumber: number,
  mode: MineDigitMode,
  smallestUnitScale: number = 100
): MineEvaluation {
  const checkedDigit = extractDigit(amount, mode, smallestUnitScale);
  return {
    checkedDigit,
    mineNumber,
    mineHit: checkedDigit === mineNumber,
  };
}
