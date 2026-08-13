import {
  type HandRank,
  HandCategory,
  CATEGORY_NAME,
  evaluateBest,
  compareHands,
} from '../texas/hand-evaluator';

export type PokerHandType =
  | 'HIGH_CARD'
  | 'ONE_PAIR'
  | 'TWO_PAIR'
  | 'THREE_OF_A_KIND'
  | 'STRAIGHT'
  | 'FLUSH'
  | 'FULL_HOUSE'
  | 'FOUR_OF_A_KIND'
  | 'STRAIGHT_FLUSH'
  | 'ROYAL_FLUSH';

export interface Card {
  id: string; // e.g. "As", "Td"
  rank: string; // "2", "T", "A"
  suit: 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';
}

export interface HandEvaluation {
  type: PokerHandType;
  rank: number;
  cards: string[]; // The 5 chosen cards
  comparisonValues: number[]; // Tiebreaker kickers
  displayName: string;
}

function getSuitName(s: string): 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS' {
  switch (s) {
    case 's':
      return 'SPADES';
    case 'h':
      return 'HEARTS';
    case 'd':
      return 'DIAMONDS';
    case 'c':
      return 'CLUBS';
    default:
      throw new Error(`Unknown suit: ${s}`);
  }
}

export function parseCardStr(card: string): Card {
  return {
    id: card,
    rank: card[0]!,
    suit: getSuitName(card[1]!),
  };
}

export function mapCategoryToPokerHandType(category: HandCategory, kickers: number[]): PokerHandType {
  switch (category) {
    case HandCategory.HighCard:
      return 'HIGH_CARD';
    case HandCategory.Pair:
      return 'ONE_PAIR';
    case HandCategory.TwoPair:
      return 'TWO_PAIR';
    case HandCategory.ThreeOfAKind:
      return 'THREE_OF_A_KIND';
    case HandCategory.Straight:
      return 'STRAIGHT';
    case HandCategory.Flush:
      return 'FLUSH';
    case HandCategory.FullHouse:
      return 'FULL_HOUSE';
    case HandCategory.FourOfAKind:
      return 'FOUR_OF_A_KIND';
    case HandCategory.StraightFlush:
      // A Royal Flush is an Ace-high Straight Flush
      return kickers[0] === 14 ? 'ROYAL_FLUSH' : 'STRAIGHT_FLUSH';
    default:
      throw new Error(`Unknown category: ${category}`);
  }
}

function buildDisplayName(category: HandCategory, tiebreak: number[]): string {
  // We can build more advanced localized names, but standard ones suffice for now.
  const name = CATEGORY_NAME[category] ?? 'Unknown Hand';
  if (category === HandCategory.StraightFlush && tiebreak[0] === 14) {
    return 'Royal Flush';
  }
  return name;
}

/**
 * Given 7 cards (2 hole + 5 community), finds the best 5-card Texas Hold'em hand
 * and formats it as HandEvaluation.
 */
export function evaluateTexasCowboyHand(cards: string[]): HandEvaluation {
  const best: HandRank = evaluateBest(cards);
  
  return {
    type: mapCategoryToPokerHandType(best.category, best.tiebreak),
    rank: best.category, // HandCategory is 0 to 8
    cards: best.cards,
    comparisonValues: best.tiebreak,
    displayName: buildDisplayName(best.category, best.tiebreak),
  };
}

/**
 * Compare two evaluated hands to determine the winner.
 * Returns:
 * "COWBOY_WIN" if cowboy > cowgirl
 * "COWGIRL_WIN" if cowgirl > cowboy
 * "TIE" if exactly equal
 */
export function compareCowboyHands(
  cowboy: HandEvaluation,
  cowgirl: HandEvaluation
): 'COWBOY_WIN' | 'COWGIRL_WIN' | 'TIE' {
  // Reconstruct minimal HandRank to use the standard compareHands
  const a: HandRank = { category: cowboy.rank, tiebreak: cowboy.comparisonValues, cards: cowboy.cards };
  const b: HandRank = { category: cowgirl.rank, tiebreak: cowgirl.comparisonValues, cards: cowgirl.cards };
  
  const diff = compareHands(a, b);
  
  if (diff > 0) return 'COWBOY_WIN';
  if (diff < 0) return 'COWGIRL_WIN';
  return 'TIE';
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];

export function createDeck(): string[] {
  const deck: string[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

/** Fisher-Yates shuffle. */
export function shuffleDeck(deck: string[], randomFn: () => number = Math.random): string[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }
  return shuffled;
}

export function dealRound(deck: string[]): {
  cowboyHole: string[];
  cowgirlHole: string[];
  community: string[];
  remaining: string[];
} {
  if (deck.length < 9) throw new Error('Not enough cards in deck');
  
  return {
    cowboyHole: [deck[0]!, deck[1]!],
    cowgirlHole: [deck[2]!, deck[3]!],
    community: [deck[4]!, deck[5]!, deck[6]!, deck[7]!, deck[8]!],
    remaining: deck.slice(9),
  };
}
