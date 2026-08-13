import { type MoneyAmount, multiplyRaw, toMoney } from '../money/money';
import { type RoundingPolicy, roundAccordingToPolicy } from '../money/rounding';
import type { MineEvaluation } from './evaluator';

export interface SettlementConfig {
  penaltyMultiplier: number;
  roundingPolicy: RoundingPolicy;
}

export interface ClaimSettlement {
  prizeKept: MoneyAmount;
  penaltyPaid: MoneyAmount;
  finalNetChange: number; // Positive means user gained, negative means user lost
}

/**
 * Calculates the final settlement of a claim based on the mine evaluation.
 */
export function settleClaim(
  amount: MoneyAmount,
  evaluation: MineEvaluation,
  config: SettlementConfig
): ClaimSettlement {
  if (!evaluation.mineHit) {
    return {
      prizeKept: amount,
      penaltyPaid: toMoney(0),
      finalNetChange: amount.units,
    };
  }

  // Mine Hit
  const rawPenalty = multiplyRaw(amount, config.penaltyMultiplier);
  const finalPenaltyUnits = roundAccordingToPolicy(rawPenalty, config.roundingPolicy);
  
  return {
    prizeKept: toMoney(0),
    penaltyPaid: toMoney(finalPenaltyUnits),
    finalNetChange: -finalPenaltyUnits,
  };
}
