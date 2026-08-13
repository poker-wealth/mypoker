import { type Card, RANK_ORDER, SUIT_ORDER } from './card';

export type BullType =
  | 'NO_BULL'
  | 'BULL_1'
  | 'BULL_2'
  | 'BULL_3'
  | 'BULL_4'
  | 'BULL_5'
  | 'BULL_6'
  | 'BULL_7'
  | 'BULL_8'
  | 'BULL_9'
  | 'BULL_BULL';

export const BULL_RANKINGS: Record<BullType, number> = {
  NO_BULL: 0,
  BULL_1: 1,
  BULL_2: 2,
  BULL_3: 3,
  BULL_4: 4,
  BULL_5: 5,
  BULL_6: 6,
  BULL_7: 7,
  BULL_8: 8,
  BULL_9: 9,
  BULL_BULL: 10,
};

export interface HandEvaluation {
  type: BullType;
  bullValue: number; // 0 for NO_BULL, 1..9 for BULL_1..9, 10 for BULL_BULL
  bestThreeCards: Card[];
  remainingTwoCards: Card[];
  highestCard: Card;
}

export type ComparisonResult = 'PLAYER_WIN' | 'PLAYER_LOSS' | 'TIE';

/**
 * Finds highest card in hand by Rank -> Suit.
 */
export function getHighestCard(cards: Card[]): Card {
  if (cards.length === 0) throw new Error('cards array cannot be empty');
  let best = cards[0]!;
  for (let i = 1; i < cards.length; i++) {
    const current = cards[i]!;
    if (RANK_ORDER[current.rank] > RANK_ORDER[best.rank]) {
      best = current;
    } else if (RANK_ORDER[current.rank] === RANK_ORDER[best.rank]) {
      if (SUIT_ORDER[current.suit] > SUIT_ORDER[best.suit]) {
        best = current;
      }
    }
  }
  return best;
}

/** One way of splitting a hand: three cards that divide by ten, and the two left over. */
export interface BullPartition {
  trio: Card[];
  duo: Card[];
  type: BullType;
  bullValue: number;
}

/**
 * Every valid way to split this hand — all `C(5,3) = 10` combinations tested, not the first that
 * works. A hand can hold several; which one you keep decides whether it is Bull 3 or Bull Bull.
 */
export function findBullCombination(cards: Card[]): BullPartition[] {
  if (cards.length !== 5) throw new Error('Hand must contain exactly 5 cards');
  const partitions: BullPartition[] = [];

  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      for (let k = j + 1; k < 5; k++) {
        const trio = [cards[i]!, cards[j]!, cards[k]!];
        if ((trio[0]!.value + trio[1]!.value + trio[2]!.value) % 10 !== 0) continue;

        const duo = cards.filter((_, idx) => idx !== i && idx !== j && idx !== k);
        const { type, bullValue } = calculateBullValue(duo[0]!.value + duo[1]!.value);
        partitions.push({ trio, duo, type, bullValue });
      }
    }
  }

  return partitions;
}

/** The bull the leftover two cards make: their last digit, or Bull Bull when they divide by ten. */
export function calculateBullValue(duoSum: number): { type: BullType; bullValue: number } {
  const remainder = duoSum % 10;
  return remainder === 0
    ? { type: 'BULL_BULL', bullValue: 10 }
    : { type: `BULL_${remainder}` as BullType, bullValue: remainder };
}

/**
 * Exhaustively evaluates a 5-card hand across all C(5,3) = 10 partitions.
 * Selects the partition that produces the strongest Bull hand.
 */
export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length !== 5) throw new Error('Hand must contain exactly 5 cards');

  const highestCard = getHighestCard(cards);
  let bestEval: HandEvaluation | null = null;

  // Exhaustively test all C(5,3) = 10 combinations
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      for (let k = j + 1; k < 5; k++) {
        const c1 = cards[i]!;
        const c2 = cards[j]!;
        const c3 = cards[k]!;
        const trioSum = c1.value + c2.value + c3.value;

        if (trioSum % 10 === 0) {
          const trio = [c1, c2, c3];
          const duo = cards.filter((_, idx) => idx !== i && idx !== j && idx !== k);
          const duoSum = duo[0]!.value + duo[1]!.value;
          const remainder = duoSum % 10;

          let type: BullType;
          let bullValue: number;

          if (remainder === 0) {
            type = 'BULL_BULL';
            bullValue = 10;
          } else {
            type = `BULL_${remainder}` as BullType;
            bullValue = remainder;
          }

          const currentEval: HandEvaluation = {
            type,
            bullValue,
            bestThreeCards: trio,
            remainingTwoCards: duo,
            highestCard,
          };

          if (
            !bestEval ||
            BULL_RANKINGS[currentEval.type] > BULL_RANKINGS[bestEval.type]
          ) {
            bestEval = currentEval;
          }
        }
      }
    }
  }

  if (bestEval) return bestEval;

  // If no 3-card combination sums to a multiple of 10, it is NO_BULL
  return {
    type: 'NO_BULL',
    bullValue: 0,
    bestThreeCards: [],
    remainingTwoCards: cards,
    highestCard,
  };
}

/**
 * Compares Player hand against Banker hand.
 * Returns PLAYER_WIN, PLAYER_LOSS, or TIE.
 */
export function compareHands(
  playerHand: HandEvaluation,
  bankerHand: HandEvaluation,
): ComparisonResult {
  const pRank = BULL_RANKINGS[playerHand.type];
  const bRank = BULL_RANKINGS[bankerHand.type];

  if (pRank > bRank) return 'PLAYER_WIN';
  if (pRank < bRank) return 'PLAYER_LOSS';

  // Tied Bull rank -> Tie-break by highest card (Rank -> Suit)
  const pHigh = playerHand.highestCard;
  const bHigh = bankerHand.highestCard;

  const pCardRank = RANK_ORDER[pHigh.rank];
  const bCardRank = RANK_ORDER[bHigh.rank];

  if (pCardRank > bCardRank) return 'PLAYER_WIN';
  if (pCardRank < bCardRank) return 'PLAYER_LOSS';

  const pSuit = SUIT_ORDER[pHigh.suit];
  const bSuit = SUIT_ORDER[bHigh.suit];

  if (pSuit > bSuit) return 'PLAYER_WIN';
  if (pSuit < bSuit) return 'PLAYER_LOSS';

  return 'TIE';
}
