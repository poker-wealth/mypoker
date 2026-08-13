export type Suit = 'SPADES' | 'HEARTS' | 'DIAMONDS' | 'CLUBS';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  value: number; // A=1, 2..9=pip, 10/J/Q/K=10
}

export const SUIT_ORDER: Record<Suit, number> = {
  CLUBS: 1,
  DIAMONDS: 2,
  HEARTS: 3,
  SPADES: 4,
};

export const RANK_ORDER: Record<Rank, number> = {
  A: 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
};

export function getBullValue(rank: Rank): number {
  if (rank === 'A') return 1;
  const num = Number(rank);
  if (!Number.isNaN(num) && num >= 2 && num <= 9) return num;
  return 10; // 10, J, Q, K
}

export function createDeck(): Card[] {
  const suits: Suit[] = ['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS'];
  const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck: Card[] = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: `${rank}-${suit}`,
        suit,
        rank,
        value: getBullValue(rank),
      });
    }
  }

  return deck;
}

export function shuffleDeck(deck: Card[], randomFn: () => number = Math.random): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }
  return shuffled;
}

export const HAND_SIZE = 5;

/**
 * Deal five cards to each player off the top of the deck, and hand back what is left.
 *
 * Pure: takes a deck, returns hands and the rest of it. The engine keeps the remainder so the
 * round can be audited — twenty cards out of fifty-two, and the other thirty-two still accounted
 * for.
 */
export function dealCards(
  deck: Card[],
  playerIds: string[],
): { hands: Record<string, Card[]>; remaining: Card[] } {
  const needed = playerIds.length * HAND_SIZE;
  if (deck.length < needed) {
    throw new Error(`deck holds ${deck.length} cards, need ${needed} for ${playerIds.length} players`);
  }

  const hands: Record<string, Card[]> = {};
  playerIds.forEach((id, seat) => {
    hands[id] = deck.slice(seat * HAND_SIZE, (seat + 1) * HAND_SIZE);
  });

  return { hands, remaining: deck.slice(needed) };
}
