import { type HandEvaluation, compareHands } from './evaluator';

export interface Bet {
  playerId: string;
  amount: number;
  multiplier: number; // 1, 2, 5
}

export interface BankerState {
  playerId: string;
  multiplier: number; // 1, 2, 5
}

export interface Settlement {
  playerId: string;
  result: 'WIN' | 'LOSS' | 'TIE';
  stake: number;
  multiplier: number;
  payout: number; // Net winnings for player (positive for win, negative for loss, 0 for tie)
  netChange: number;
}

/**
 * What a bet pays, win or lose: stake × player multiplier × banker multiplier.
 *
 * Throughout this engine `payout` means PROFIT — what changes hands — not the stake coming back
 * with it. A ₦1,000 bet at 2x against a 5x bank pays ₦10,000 on a win and costs ₦10,000 on a loss.
 */
export function calculatePayout(amount: number, betMultiplier: number, bankerMultiplier: number): number {
  return amount * betMultiplier * bankerMultiplier;
}

/**
 * Calculates settlement for a single player vs Banker.
 * Payout multiplier = Bet Amount * Player Multiplier * Banker Multiplier.
 */
export function calculateSettlement(
  playerId: string,
  playerEvaluation: HandEvaluation,
  bankerEvaluation: HandEvaluation,
  bet: Bet,
  bankerMultiplier: number,
): Settlement {
  const result = compareHands(playerEvaluation, bankerEvaluation);
  const totalMultiplier = bet.multiplier * bankerMultiplier;
  const grossOutcome = calculatePayout(bet.amount, bet.multiplier, bankerMultiplier);

  let netChange = 0;
  let outcomeType: 'WIN' | 'LOSS' | 'TIE' = 'TIE';

  if (result === 'PLAYER_WIN') {
    outcomeType = 'WIN';
    netChange = grossOutcome;
  } else if (result === 'PLAYER_LOSS') {
    outcomeType = 'LOSS';
    netChange = -grossOutcome;
  }

  return {
    playerId,
    result: outcomeType,
    stake: bet.amount,
    multiplier: totalMultiplier,
    payout: netChange,
    netChange,
  };
}

/**
 * Verifies the fundamental casino accounting invariant:
 * Sum of all player net changes + Banker net change === 0.
 */
export function verifyAccountingInvariant(
  playerSettlements: Settlement[],
  bankerNetChange: number,
): boolean {
  const playerSum = playerSettlements.reduce((sum, s) => sum + s.netChange, 0);
  return playerSum + bankerNetChange === 0;
}
