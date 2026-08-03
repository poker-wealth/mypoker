import { parseCard } from '../texas/hand-evaluator';

/**
 * San Zhang (三张 / Zha Jin Hua) — 3-card hand evaluation.
 *
 * Ranking (per spec, note this differs from western poker): Three of a Kind is the HIGHEST,
 * above a straight flush:
 *   Three of a Kind > Straight Flush > Flush > Straight > Pair > High Card.
 *
 * Aces are high, except the A-2-3 wheel (the lowest straight). Cards are 'As', 'Td', '9c' (T=ten).
 */

export enum SanZhangCategory {
  HighCard = 0,
  Pair = 1,
  Straight = 2,
  Flush = 3,
  StraightFlush = 4,
  ThreeOfAKind = 5,
}

export const SAN_ZHANG_CATEGORY_NAME: Readonly<Record<SanZhangCategory, string>> = {
  [SanZhangCategory.HighCard]: 'High Card',
  [SanZhangCategory.Pair]: 'Pair',
  [SanZhangCategory.Straight]: 'Straight',
  [SanZhangCategory.Flush]: 'Flush',
  [SanZhangCategory.StraightFlush]: 'Straight Flush',
  [SanZhangCategory.ThreeOfAKind]: 'Three of a Kind',
};

export interface SanZhangRank {
  category: SanZhangCategory;
  tiebreak: number[];
}

export function evaluate3(cards: readonly string[]): SanZhangRank {
  if (cards.length !== 3) throw new Error('San Zhang hand must be exactly 3 cards');
  const parsed = cards.map(parseCard);
  const ranksDesc = parsed.map((c) => c.rank).sort((a, b) => b - a);
  const distinct = [...new Set(ranksDesc)];
  const isFlush = parsed.every((c) => c.suit === parsed[0]!.suit);

  // Straight high (0 if not a straight).
  let straightHigh = 0;
  if (distinct.length === 3) {
    if (ranksDesc[0]! - ranksDesc[2]! === 2) straightHigh = ranksDesc[0]!;
    else if (ranksDesc[0] === 14 && ranksDesc[1] === 3 && ranksDesc[2] === 2) straightHigh = 3; // wheel
  }

  if (distinct.length === 1) {
    return { category: SanZhangCategory.ThreeOfAKind, tiebreak: [ranksDesc[0]!] };
  }
  if (straightHigh && isFlush) {
    return { category: SanZhangCategory.StraightFlush, tiebreak: [straightHigh] };
  }
  if (isFlush) {
    return { category: SanZhangCategory.Flush, tiebreak: ranksDesc };
  }
  if (straightHigh) {
    return { category: SanZhangCategory.Straight, tiebreak: [straightHigh] };
  }
  if (distinct.length === 2) {
    // Pair: the rank appearing twice, then the kicker.
    const pairRank = ranksDesc[0] === ranksDesc[1] ? ranksDesc[0]! : ranksDesc[1]!;
    const kicker = ranksDesc.find((r) => r !== pairRank)!;
    return { category: SanZhangCategory.Pair, tiebreak: [pairRank, kicker] };
  }
  return { category: SanZhangCategory.HighCard, tiebreak: ranksDesc };
}

/** > 0 if a beats b, < 0 if b beats a, 0 if identical rank. */
export function compare3(a: SanZhangRank, b: SanZhangRank): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
