import { classifyPlay, beats, type Combo } from './combos';
import { cardRank } from './ddz-deck';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  combination?: Combo;
}

/**
 * Strict move validator for Dou Dizhu.
 */
export function validateMove(
  selectedCards: string[],
  previousCombination: Combo | null,
  playerHand: string[],
): ValidationResult {
  if (selectedCards.length === 0) {
    return { valid: false, reason: 'no cards selected' };
  }

  // 1. Ownership & Duplicate check
  const handCopy = [...playerHand];
  for (const card of selectedCards) {
    const idx = handCopy.indexOf(card);
    if (idx === -1) {
      return { valid: false, reason: `card ${card} not in player hand` };
    }
    handCopy.splice(idx, 1);
  }

  // 2. Combination Legality
  const ranks = selectedCards.map(cardRank);
  const combo = classifyPlay(ranks);
  if (!combo) {
    return { valid: false, reason: 'selected cards do not form a legal Dou Dizhu combination' };
  }

  // 3. Comparison against previous combination
  if (previousCombination) {
    if (!beats(previousCombination, combo)) {
      return { valid: false, reason: 'combination does not beat the current table play', combination: combo };
    }
  }

  return { valid: true, combination: combo };
}
