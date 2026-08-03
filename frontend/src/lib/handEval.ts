/**
 * Standard Texas Hold'em hand evaluator for the play-money demo table.
 *
 * Scores the best 5-of-7 as [category, ...tiebreak] arrays that compare
 * lexicographically. Categories mirror the game-server's HandCategory ordering
 * (0 High … 8 Straight Flush). Aces are high, with the A-2-3-4-5 wheel handled.
 * The authoritative money engine still lives server-side; this only drives the UI.
 */
import type { Card } from './cards';

export const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
] as const;

const RANK_VALUE: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

const valueOf = (c: Card): number => RANK_VALUE[c[0]];

/** Score of a specific 5-card hand: [category, ...kickers], higher wins. */
function score5(cards: Card[]): number[] {
  const values = cards.map(valueOf).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);

  // unique descending values for straight detection
  const uniq = [...new Set(values)].sort((a, b) => b - a);
  let straightHigh = 0;
  for (let i = 0; i <= uniq.length - 5; i++) {
    if (uniq[i] - uniq[i + 4] === 4) {
      straightHigh = uniq[i];
      break;
    }
  }
  // wheel: A-2-3-4-5
  if (!straightHigh && uniq.includes(14) && [5, 4, 3, 2].every((v) => uniq.includes(v))) {
    straightHigh = 5;
  }

  // rank multiplicities
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const kickersDesc = (exclude: number[]) => values.filter((v) => !exclude.includes(v));

  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], ...kickersDesc([groups[0][0]]).slice(0, 1)];
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...values.slice(0, 5)];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], ...kickersDesc([groups[0][0]]).slice(0, 2)];
  if (groups[0][1] === 2 && groups[1]?.[1] === 2)
    return [2, groups[0][0], groups[1][0], ...kickersDesc([groups[0][0], groups[1][0]]).slice(0, 1)];
  if (groups[0][1] === 2) return [1, groups[0][0], ...kickersDesc([groups[0][0]]).slice(0, 3)];
  return [0, ...values.slice(0, 5)];
}

/** All k-combinations of indices [0..n). */
function combos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) return void out.push([...acc]);
    for (let i = start; i < n; i++) {
      acc.push(i);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

export interface HandScore {
  score: number[];
  category: number;
  name: string;
}

/** Best 5-card hand out of up to 7 cards. */
export function evaluate(cards: Card[]): HandScore {
  if (cards.length < 5) {
    // not enough to make a 5-card hand yet — rank by high cards only
    const values = cards.map(valueOf).sort((a, b) => b - a);
    return { score: [0, ...values], category: 0, name: CATEGORY_NAMES[0] };
  }
  let best: number[] | null = null;
  for (const idx of combos(cards.length, 5)) {
    const s = score5(idx.map((i) => cards[i]));
    if (!best || compareScore(s, best) > 0) best = s;
  }
  return { score: best!, category: best![0], name: CATEGORY_NAMES[best![0]] };
}

/** Lexicographic comparison: >0 if a beats b, 0 if tie. */
export function compareScore(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
