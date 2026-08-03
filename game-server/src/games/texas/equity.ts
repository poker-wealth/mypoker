import { standardDeck } from '../../fairness/shuffle';
import { evaluateBest, compareHands } from './hand-evaluator';

/**
 * Hand equity by exhaustive enumeration of the cards still to come.
 *
 * Used by the insurance underwriter: given the two all-in hands and the current board (flop = 2
 * cards to come, turn = 1 to come), it counts how often the insured hand wins, ties, or loses — the
 * loss probability is the basis for a fair insurance premium.
 */

export interface Equity {
  wins: number;
  ties: number;
  losses: number;
  total: number;
  /** Probability the insured hand loses (its bad-beat risk). */
  lossProbability: number;
}

function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
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

export function computeEquity(
  insured: readonly string[],
  opponent: readonly string[],
  board: readonly string[],
): Equity {
  const known = new Set<string>([...insured, ...opponent, ...board]);
  const remaining = standardDeck().filter((c) => !known.has(c));
  const toCome = 5 - board.length;
  if (toCome < 0) throw new Error('board already complete');

  let wins = 0;
  let ties = 0;
  let losses = 0;
  let total = 0;
  for (const runout of combinations(remaining, toCome)) {
    const fullBoard = [...board, ...runout];
    const a = evaluateBest([...insured, ...fullBoard]);
    const b = evaluateBest([...opponent, ...fullBoard]);
    const cmp = compareHands(a, b);
    if (cmp > 0) wins++;
    else if (cmp < 0) losses++;
    else ties++;
    total++;
  }
  return { wins, ties, losses, total, lossProbability: total === 0 ? 0 : losses / total };
}
