import type { BetLimit } from './betting';
import { shuffle } from '../../fairness/shuffle';
import { standardDeck } from '../../fairness/shuffle';
import {
  evaluateBest,
  evaluateOmaha,
  SHORT_DECK_RULES,
  STANDARD_RULES,
  type HandRank,
} from './hand-evaluator';

/**
 * The three Hold'em-family variants we deal.
 *
 * Everything downstream — betting, side pots, showdown, settlement, the provably-fair shuffle — is
 * shared and untouched. A variant only changes three things: the deck, how many cards you're dealt,
 * and how a hand is scored.
 */

const SHORT_DECK_RANKS = ['6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['c', 'd', 'h', 's'] as const;

/** Short Deck (6+): the 2s through 5s are stripped — 36 cards. */
export function shortDeck(): string[] {
  const deck: string[] = [];
  for (const rank of SHORT_DECK_RANKS) {
    for (const suit of SUITS) deck.push(`${rank}${suit}`);
  }
  return deck;
}

export type VariantId = 'texas' | 'short-deck' | 'omaha';

export interface PokerVariant {
  id: VariantId;
  name: string;
  /** Cards dealt to each player. */
  holeCards: number;
  /** The provably-fair deck for this variant, from the round's final seed. */
  deckFor(seed: string): string[];
  /** Score a player's hand against the finished board. */
  evaluate(hole: readonly string[], board: readonly string[]): HandRank;
  /**
   * How big a raise may be. Omaha is POT_LIMIT — that is what makes PLO play
   * differently from a game where anyone can shove on any street. Absent means
   * NO_LIMIT, which is Hold'em and Short Deck.
   */
  limit?: BetLimit;
  /**
   * The most chairs a table of this variant may have. THE one source of truth —
   * every path that creates a table checks this, and the lobby catalogue is
   * derived from it.
   *
   * The number is set by the FELT, not by the rules. Each design in
   * `frontend/src/lib/tableDesigns.ts` defines seat positions per count, and
   * only up to a point: the portrait stadium felt defines 2–6, the wide felt
   * 2–8. Ask for more than that and `ringFor` falls through to an evenly-spaced
   * circle, which on an oval felt drops players into the middle of the table
   * instead of onto the rail.
   *
   * So RAISING one of these is not a one-line change here — it needs the rings
   * for that count to exist first. Lowering one is free.
   */
  maxSeats: number;
}

export const TEXAS: PokerVariant = {
  id: 'texas',
  name: "Texas Hold'em",
  holeCards: 2,
  deckFor: (seed) => shuffle(standardDeck(), seed),
  evaluate: (hole, board) => evaluateBest([...hole, ...board], STANDARD_RULES),
  // Portrait stadium felt: `stadiumRings` defines 2..6 and nothing above.
  maxSeats: 6,
};

export const SHORT_DECK: PokerVariant = {
  id: 'short-deck',
  name: "Short Deck Hold'em",
  holeCards: 2,
  deckFor: (seed) => shuffle(shortDeck(), seed),
  // Short-deck rules: flush beats full house, and A-6-7-8-9 is the low straight.
  evaluate: (hole, board) => evaluateBest([...hole, ...board], SHORT_DECK_RULES),
  // Wide landscape felt: `wideRings` defines 2..8.
  maxSeats: 8,
};

export const OMAHA: PokerVariant = {
  id: 'omaha',
  name: 'Omaha',
  holeCards: 4,
  deckFor: (seed) => shuffle(standardDeck(), seed),
  // Exactly two from hand, exactly three from the board — enforced by evaluateOmaha.
  evaluate: (hole, board) => evaluateOmaha([...hole], [...board], STANDARD_RULES),
  // Omaha is POT-limit. With four hole cards everyone flops something, and
  // no-limit sizing on top of that turns every board into a shove-or-fold.
  limit: 'POT_LIMIT',
  // Wide landscape felt, same as Short Deck.
  maxSeats: 8,
};

export const VARIANTS: Readonly<Record<VariantId, PokerVariant>> = {
  texas: TEXAS,
  'short-deck': SHORT_DECK,
  omaha: OMAHA,
};

export function variant(id: VariantId): PokerVariant {
  const v = VARIANTS[id];
  if (!v) throw new RangeError(`unknown variant: ${id}`);
  return v;
}
