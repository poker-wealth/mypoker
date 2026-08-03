/**
 * Dou Di Zhu uses a 54-card deck: the standard 52 plus a small (black) joker and a big (red) joker.
 * Cards are 'Rs' strings ('3c'…'2s'), with jokers as 'js' (small) and 'jb' (big).
 */

const SUITS = ['c', 'd', 'h', 's'] as const;
const RANKS = ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2'] as const;

export const SMALL_JOKER = 'js';
export const BIG_JOKER = 'jb';

const RANK_VALUE: Readonly<Record<string, number>> = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14, '2': 15,
};

/** Build the 54-card deck in canonical order. */
export function build54Deck(): string[] {
  const deck: string[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) deck.push(`${rank}${suit}`);
  }
  deck.push(SMALL_JOKER, BIG_JOKER);
  return deck;
}

/** Dou Di Zhu rank value of a card: 3..10, J=11…A=14, 2=15, small joker=16, big joker=17. */
export function cardRank(card: string): number {
  if (card === SMALL_JOKER) return 16;
  if (card === BIG_JOKER) return 17;
  const v = RANK_VALUE[card[0] ?? ''];
  if (v === undefined) throw new Error(`invalid card: ${card}`);
  return v;
}
