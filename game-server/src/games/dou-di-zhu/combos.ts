/**
 * Dou Di Zhu (斗地主) — play classification and comparison ("play-legality").
 *
 * Works on rank values, since suits are irrelevant in Dou Di Zhu:
 *   3..10 = 3..10, J=11, Q=12, K=13, A=14, 2=15, small joker=16, big joker=17.
 *
 * Sequences (straights, pair-straights, airplanes) may only use 3..A (≤14) — never 2 or jokers.
 * Bombs (four of a kind) beat any non-bomb; a rocket (both jokers) beats everything.
 */

export enum ComboType {
  Single = 'single',
  Pair = 'pair',
  Triple = 'triple',
  TripleOne = 'triple+1',
  TripleTwo = 'triple+2',
  Straight = 'straight',
  PairStraight = 'pair-straight',
  Airplane = 'airplane',
  AirplaneSingles = 'airplane+singles',
  AirplanePairs = 'airplane+pairs',
  Bomb = 'bomb',
  Rocket = 'rocket',
  FourTwoSingles = 'four+2-singles',
  FourTwoPairs = 'four+2-pairs',
}

export interface Combo {
  type: ComboType;
  /** The rank the play is compared by (top of a sequence; the quad/triple/pair/single rank). */
  rank: number;
  /** Number of consecutive groups (for straights/airplanes); 1 otherwise. */
  length: number;
}

const SMALL_JOKER = 16;
const BIG_JOKER = 17;

/** Distinct ranks (ascending) form a consecutive run using only 3..A (≤14). */
function isRun(distinctAsc: number[]): boolean {
  if (distinctAsc.some((r) => r > 14)) return false; // no 2 / jokers in sequences
  for (let i = 1; i < distinctAsc.length; i++) {
    if (distinctAsc[i] !== distinctAsc[i - 1]! + 1) return false;
  }
  return true;
}

export function classifyPlay(ranks: readonly number[]): Combo | null {
  const n = ranks.length;
  if (n === 0) return null;

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const distinct = [...counts.keys()].sort((a, b) => a - b);
  const countVals = [...counts.values()];
  const top = distinct[distinct.length - 1]!;

  // Rocket / Bomb first (they short-circuit everything).
  if (n === 2 && counts.get(SMALL_JOKER) === 1 && counts.get(BIG_JOKER) === 1) {
    return { type: ComboType.Rocket, rank: BIG_JOKER, length: 1 };
  }
  if (n === 4 && distinct.length === 1) {
    return { type: ComboType.Bomb, rank: distinct[0]!, length: 1 };
  }

  // Single / Pair / Triple.
  if (distinct.length === 1) {
    const c = counts.get(distinct[0]!)!;
    if (c === 1) return { type: ComboType.Single, rank: distinct[0]!, length: 1 };
    if (c === 2) return { type: ComboType.Pair, rank: distinct[0]!, length: 1 };
    if (c === 3) return { type: ComboType.Triple, rank: distinct[0]!, length: 1 };
  }

  const tripleRank = distinct.find((r) => counts.get(r) === 3);

  // Triple + single, Triple + pair.
  if (n === 4 && tripleRank !== undefined) {
    return { type: ComboType.TripleOne, rank: tripleRank, length: 1 };
  }
  if (n === 5 && tripleRank !== undefined && distinct.some((r) => counts.get(r) === 2)) {
    return { type: ComboType.TripleTwo, rank: tripleRank, length: 1 };
  }

  // Straight (≥5 consecutive singles).
  if (countVals.every((c) => c === 1) && distinct.length >= 5 && isRun(distinct)) {
    return { type: ComboType.Straight, rank: top, length: distinct.length };
  }
  // Pair-straight (≥3 consecutive pairs).
  if (countVals.every((c) => c === 2) && distinct.length >= 3 && isRun(distinct)) {
    return { type: ComboType.PairStraight, rank: top, length: distinct.length };
  }

  // Airplane: ≥2 consecutive triples, optionally with equal single or pair wings.
  const tripleRanks = distinct.filter((r) => counts.get(r) === 3).sort((a, b) => a - b);
  if (tripleRanks.length >= 2 && isRun(tripleRanks)) {
    const k = tripleRanks.length;
    const wings = n - 3 * k;
    const wingRanks = distinct.filter((r) => !tripleRanks.includes(r));
    const topTriple = tripleRanks[k - 1]!;
    if (wings === 0 && distinct.length === k) {
      return { type: ComboType.Airplane, rank: topTriple, length: k };
    }
    if (wings === k && wingRanks.length === k && wingRanks.every((r) => counts.get(r) === 1)) {
      return { type: ComboType.AirplaneSingles, rank: topTriple, length: k };
    }
    if (wings === 2 * k && wingRanks.length === k && wingRanks.every((r) => counts.get(r) === 2)) {
      return { type: ComboType.AirplanePairs, rank: topTriple, length: k };
    }
    return null;
  }

  // Four + two singles / two pairs (NOT a bomb — cannot beat bombs).
  const quad = distinct.find((r) => counts.get(r) === 4);
  if (quad !== undefined) {
    const rest = distinct.filter((r) => r !== quad);
    if (n === 6) return { type: ComboType.FourTwoSingles, rank: quad, length: 1 };
    if (n === 8 && rest.length === 2 && rest.every((r) => counts.get(r) === 2)) {
      return { type: ComboType.FourTwoPairs, rank: quad, length: 1 };
    }
  }

  return null;
}

/** Can `next` legally beat `prev`? */
export function beats(prev: Combo, next: Combo): boolean {
  if (next.type === ComboType.Rocket) return true;
  if (prev.type === ComboType.Rocket) return false;
  if (next.type === ComboType.Bomb) {
    return prev.type === ComboType.Bomb ? next.rank > prev.rank : true;
  }
  if (prev.type === ComboType.Bomb) return false; // only a bigger bomb or rocket beats a bomb
  // Otherwise same shape (type + length) and a higher rank.
  return next.type === prev.type && next.length === prev.length && next.rank > prev.rank;
}
