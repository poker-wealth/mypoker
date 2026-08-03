/**
 * Texas Hold'em hand evaluator — finds the best 5-card hand out of 7 and makes hands comparable
 * (for showdown and side-pot winner determination).
 *
 * A hand is scored as a category plus a tiebreak vector of rank values; hands compare by category
 * first, then lexicographically by tiebreak (kickers). Aces are high, except the wheel (A-2-3-4-5)
 * where the ace plays low. Cards are strings like 'As', 'Td', '9c' (T = ten).
 */

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAME: Readonly<Record<HandCategory, string>> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.Pair]: 'Pair',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.ThreeOfAKind]: 'Three of a Kind',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.FourOfAKind]: 'Four of a Kind',
  [HandCategory.StraightFlush]: 'Straight Flush',
};

export interface HandRank {
  category: HandCategory;
  /**
   * How strong this category is *under the variant's rules* — this, not `category`, is what hands
   * compare on. In standard poker it equals `category`; in Short Deck a flush outranks a full house,
   * so a flush carries a higher strength. Keeping the ordering here means side-pots, showdown and
   * every other consumer stay variant-agnostic. Omitted → falls back to `category`.
   */
  strength?: number;
  /** Rank values that break ties within a category, most significant first. */
  tiebreak: number[];
  /** The chosen best-5 cards. */
  cards: string[];
}

/**
 * The rules that differ between poker variants: which ranks form the ace-low straight, and how the
 * categories are ordered.
 */
export interface HandRules {
  /** The ace-low straight (A-2-3-4-5 normally; A-6-7-8-9 in Short Deck) and the high card it makes. */
  aceLowStraight: { ranks: number[]; high: number };
  /** Strength of each category — higher wins. */
  order: Readonly<Record<HandCategory, number>>;
}

const IDENTITY_ORDER: Readonly<Record<HandCategory, number>> = {
  [HandCategory.HighCard]: 0,
  [HandCategory.Pair]: 1,
  [HandCategory.TwoPair]: 2,
  [HandCategory.ThreeOfAKind]: 3,
  [HandCategory.Straight]: 4,
  [HandCategory.Flush]: 5,
  [HandCategory.FullHouse]: 6,
  [HandCategory.FourOfAKind]: 7,
  [HandCategory.StraightFlush]: 8,
};

export const STANDARD_RULES: HandRules = {
  aceLowStraight: { ranks: [14, 5, 4, 3, 2], high: 5 },
  order: IDENTITY_ORDER,
};

/**
 * Short Deck (6+ Hold'em): the 2s–5s are stripped, so a flush becomes RARER than a full house and
 * therefore outranks it. The ace plays low below the six, making A-6-7-8-9 the low straight.
 *
 * (Some houses also rank trips above a straight. Triton/standard rules — used here — do not.)
 */
export const SHORT_DECK_RULES: HandRules = {
  aceLowStraight: { ranks: [14, 9, 8, 7, 6], high: 9 },
  order: {
    ...IDENTITY_ORDER,
    [HandCategory.FullHouse]: 5,
    [HandCategory.Flush]: 6, // flush beats full house
  },
};

const RANK_VALUE: Readonly<Record<string, number>> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

interface ParsedCard {
  rank: number;
  suit: string;
  raw: string;
}

export function parseCard(card: string): ParsedCard {
  const rank = RANK_VALUE[card[0] ?? ''];
  const suit = card[1];
  if (rank === undefined || suit === undefined) throw new Error(`invalid card: ${card}`);
  return { rank, suit, raw: card };
}

/** Detect a straight in distinct, descending rank values. Returns the high card, or 0 if none. */
function straightHigh(distinctDesc: number[], rules: HandRules): number {
  if (distinctDesc.length < 5) return 0;
  for (let i = 0; i + 4 < distinctDesc.length; i++) {
    if (distinctDesc[i]! - distinctDesc[i + 4]! === 4) return distinctDesc[i]!;
  }
  // The ace-low straight (A-2-3-4-5 normally, A-6-7-8-9 in Short Deck).
  const { ranks, high } = rules.aceLowStraight;
  if (ranks.every((r) => distinctDesc.includes(r))) return high;
  return 0;
}

/** Score exactly five cards. */
export function evaluateFive(cards: string[], rules: HandRules = STANDARD_RULES): HandRank {
  if (cards.length !== 5) throw new Error('evaluateFive requires exactly 5 cards');
  const parsed = cards.map(parseCard);
  const ranksDesc = parsed.map((c) => c.rank).sort((a, b) => b - a);
  const distinctDesc = [...new Set(ranksDesc)].sort((a, b) => b - a);

  const isFlush = parsed.every((c) => c.suit === parsed[0]!.suit);
  const sHigh = straightHigh(distinctDesc, rules);

  // Group ranks by count, ordered by (count desc, rank desc).
  const countByRank = new Map<number, number>();
  for (const r of ranksDesc) countByRank.set(r, (countByRank.get(r) ?? 0) + 1);
  const groups = [...countByRank.entries()].sort((a, b) =>
    b[1] !== a[1] ? b[1] - a[1] : b[0] - a[0],
  );
  const counts = groups.map((g) => g[1]);
  const byCount = groups.map((g) => g[0]); // ranks ordered as above

  const result = (category: HandCategory, tiebreak: number[]): HandRank => ({
    category,
    strength: rules.order[category],
    tiebreak,
    cards,
  });

  if (isFlush && sHigh) return result(HandCategory.StraightFlush, [sHigh]);
  if (counts[0] === 4) return result(HandCategory.FourOfAKind, [byCount[0]!, byCount[1]!]);
  if (counts[0] === 3 && counts[1] === 2)
    return result(HandCategory.FullHouse, [byCount[0]!, byCount[1]!]);
  if (isFlush) return result(HandCategory.Flush, ranksDesc);
  if (sHigh) return result(HandCategory.Straight, [sHigh]);
  if (counts[0] === 3) return result(HandCategory.ThreeOfAKind, [byCount[0]!, ...kickers(byCount, 1)]);
  if (counts[0] === 2 && counts[1] === 2)
    return result(HandCategory.TwoPair, [byCount[0]!, byCount[1]!, ...kickers(byCount, 2)]);
  if (counts[0] === 2) return result(HandCategory.Pair, [byCount[0]!, ...kickers(byCount, 1)]);
  return result(HandCategory.HighCard, ranksDesc);
}

/** The remaining ranks after the first `skip` group ranks, descending (already ordered). */
function kickers(byCount: number[], skip: number): number[] {
  return byCount.slice(skip);
}

/**
 * Lexicographic comparison: > 0 if a beats b, < 0 if b beats a, 0 if tie.
 * Compares on `strength` (the variant's category ordering), then on kickers.
 */
export function compareHands(a: HandRank, b: HandRank): number {
  const sa = a.strength ?? a.category;
  const sb = b.strength ?? b.category;
  if (sa !== sb) return sa - sb;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]!);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

/** Evaluate the best 5-card hand out of 5–7 cards. */
export function evaluateBest(cards: string[], rules: HandRules = STANDARD_RULES): HandRank {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error('evaluateBest requires 5 to 7 cards');
  }
  let best: HandRank | undefined;
  for (const five of combinations(cards, 5)) {
    const rank = evaluateFive(five, rules);
    if (!best || compareHands(rank, best) > 0) best = rank;
  }
  return best!;
}

/**
 * Omaha: the best hand using EXACTLY two hole cards and EXACTLY three board cards.
 *
 * This constraint is the whole game and the classic source of misread hands — four hearts in hand
 * plus one on the board is NOT a flush, because you may only play two of your own cards. Enforcing
 * it here (rather than reusing `evaluateBest` over all nine cards) is what makes that impossible.
 */
export function evaluateOmaha(
  hole: string[],
  board: string[],
  rules: HandRules = STANDARD_RULES,
): HandRank {
  if (hole.length !== 4) throw new Error('Omaha requires exactly 4 hole cards');
  if (board.length !== 5) throw new Error('Omaha requires exactly 5 board cards');
  let best: HandRank | undefined;
  for (const twoHole of combinations(hole, 2)) {
    for (const threeBoard of combinations(board, 3)) {
      const rank = evaluateFive([...twoHole, ...threeBoard], rules);
      if (!best || compareHands(rank, best) > 0) best = rank;
    }
  }
  return best!;
}
