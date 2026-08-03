import { parseCard } from '../texas/hand-evaluator';

/**
 * Niu Niu (牛牛 / Bull Bull) — 5-card hand evaluation.
 *
 * Card points: A = 1, 2–9 = pip, 10/J/Q/K = 10. If any THREE cards sum to a multiple of 10, the
 * hand "has a bull"; the other two cards' sum mod 10 is the bull value (牛几). Sum ≡ 0 → Niu Niu
 * (the best plain hand). No qualifying trio → No Bull (worst). A few special hands outrank Niu Niu.
 *
 * Strength ladder (low → high): No Bull < Bull 1–9 < Niu Niu < Bomb (four of a kind) <
 * Five Flowers (all J/Q/K) < Five Small (all ≤4, total ≤10). The strength drives the payout multiplier.
 */

export enum NiuStrength {
  NoBull = 0,
  // Bull 1..9 use their own value as strength (1..9)
  NiuNiu = 10,
  Bomb = 11,
  FiveFlowers = 12,
  FiveSmall = 13,
}

export interface NiuRank {
  strength: number; // NiuStrength or 1..9 for a plain bull
  /** Payout multiplier for a win with this hand. */
  multiplier: number;
  /** Highest card rank, for breaking equal-strength ties. */
  highCard: number;
}

/** Payout multiplier by strength (house-configurable; these are common defaults). */
export const NIU_MULTIPLIERS: Readonly<Record<number, number>> = {
  0: 1, // no bull
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 1,
  6: 1,
  7: 2, // bull 7
  8: 2, // bull 8
  9: 3, // bull 9
  10: 4, // niu niu
  11: 5, // bomb
  12: 5, // five flowers
  13: 6, // five small
};

function niuPoints(rank: number): number {
  if (rank === 14) return 1; // Ace
  if (rank >= 10) return 10; // 10, J, Q, K
  return rank;
}

function hasBull(points: number[]): boolean {
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        if ((points[i]! + points[j]! + points[k]!) % 10 === 0) return true;
      }
    }
  }
  return false;
}

export function evaluateNiu(cards: readonly string[]): NiuRank {
  if (cards.length !== 5) throw new Error('Niu Niu hand must be exactly 5 cards');
  const parsed = cards.map(parseCard);
  const ranks = parsed.map((c) => c.rank);
  const points = ranks.map(niuPoints);
  const total = points.reduce((a, b) => a + b, 0);
  const highCard = Math.max(...ranks);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  const isBomb = [...counts.values()].some((c) => c === 4);
  const isFiveFlowers = ranks.every((r) => r >= 11 && r <= 13); // J/Q/K only
  const isFiveSmall = points.every((p) => p <= 4) && total <= 10;

  let strength: number;
  if (isFiveSmall) strength = NiuStrength.FiveSmall;
  else if (isFiveFlowers) strength = NiuStrength.FiveFlowers;
  else if (isBomb) strength = NiuStrength.Bomb;
  else if (hasBull(points)) {
    const bull = total % 10;
    strength = bull === 0 ? NiuStrength.NiuNiu : bull; // 0 → Niu Niu (10); else 1..9
  } else strength = NiuStrength.NoBull;

  return { strength, multiplier: NIU_MULTIPLIERS[strength] ?? 1, highCard };
}

/** > 0 if a beats b, < 0 if b beats a, 0 if a genuine tie (the game awards ties to the banker). */
export function compareNiu(a: NiuRank, b: NiuRank): number {
  if (a.strength !== b.strength) return a.strength - b.strength;
  return a.highCard - b.highCard;
}
