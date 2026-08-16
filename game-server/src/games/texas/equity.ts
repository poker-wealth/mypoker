import { standardDeck } from '../../fairness/shuffle';
import { scoreStandard } from './equity-fast';

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
  // Reused 7-card hands: hole + board are fixed, so we push the runout, evaluate, then truncate back —
  // instead of spreading three fresh arrays per runout (990× on the flop). bestRankStandard is the
  // allocation-free equivalent of evaluateBest under standard rules, proven byte-identical in
  // equity-fast.test.ts. Together these took the flop quote from ~1.3s (event-loop-blocking) to <30ms.
  const handA = [insured[0]!, insured[1]!, ...board];
  const handB = [opponent[0]!, opponent[1]!, ...board];
  const baseLen = 2 + board.length;
  for (const runout of combinations(remaining, toCome)) {
    for (let k = 0; k < runout.length; k++) {
      handA.push(runout[k]!);
      handB.push(runout[k]!);
    }
    // Packed integer scores that total-order exactly as compareHands — no per-runout object/array.
    const sa = scoreStandard(handA);
    const sb = scoreStandard(handB);
    if (sa > sb) wins++;
    else if (sa < sb) losses++;
    else ties++;
    total++;
    handA.length = baseLen;
    handB.length = baseLen;
  }
  return { wins, ties, losses, total, lossProbability: total === 0 ? 0 : losses / total };
}
