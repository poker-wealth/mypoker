import { uint32Stream, uniformBelow } from '../fairness/rng';

/**
 * Who wins a jackpot — and the anti-arbitrage weighting that stops it being farmed (v5.9 §5).
 *
 *   weight = base_weight × behavior_factor × non_collusion_factor
 *
 *   behavior_factor       normal 1.0 | flagged abnormal 0.5 | CONFIRMED COLLUSION 0.0
 *   non_collusion_factor  unassociated 1.0 | shares IP / device / GPS with players at the table 0.3
 *
 * A confirmed colluder's weight is ZERO, so they can never win a jackpot no matter how many hands
 * they play — which is what makes seat-stuffing pointless. Factors are held as integer percentages
 * so the weighting is exact (no float drift) and the draw is reproducible.
 *
 * The winner is drawn from the round's committed seed, so the selection is provably fair too: reveal
 * the seed and anyone can confirm we did not hand-pick the winner.
 */

export type BehaviorStatus = 'NORMAL' | 'FLAGGED' | 'COLLUDING';

export interface JackpotCandidate {
  playerId: string;
  /** Base weight — e.g. hands played, or contribution to the pool. */
  baseWeight: number;
  behavior: BehaviorStatus;
  /** Shares an IP, device or GPS location with someone else at this table. */
  associated: boolean;
}

/** Integer percentages: 1.0 → 100, 0.5 → 50, 0.0 → 0. */
const BEHAVIOR_PCT: Readonly<Record<BehaviorStatus, number>> = {
  NORMAL: 100,
  FLAGGED: 50,
  COLLUDING: 0,
};
const ASSOCIATED_PCT = 30; // 0.3
const UNASSOCIATED_PCT = 100;

export function weightOf(c: JackpotCandidate): number {
  const behavior = BEHAVIOR_PCT[c.behavior];
  const nonCollusion = c.associated ? ASSOCIATED_PCT : UNASSOCIATED_PCT;
  return c.baseWeight * behavior * nonCollusion;
}

/**
 * Draw the winner, weighted. Returns null when nobody is eligible (e.g. every candidate is a
 * confirmed colluder) — the caller must then skip the trigger rather than pay someone anyway.
 */
export function drawWinner(
  candidates: readonly JackpotCandidate[],
  seed: string,
): { playerId: string; weight: number; totalWeight: number } | null {
  const weighted = candidates
    .map((c) => ({ playerId: c.playerId, weight: weightOf(c) }))
    .filter((w) => w.weight > 0);
  const totalWeight = weighted.reduce((a, w) => a + w.weight, 0);
  if (totalWeight <= 0) return null;

  const roll = uniformBelow(uint32Stream(`${seed}:jackpot-winner`), totalWeight);
  let cursor = 0;
  for (const w of weighted) {
    cursor += w.weight;
    if (roll < cursor) return { playerId: w.playerId, weight: w.weight, totalWeight };
  }
  /* c8 ignore next */
  return { playerId: weighted[weighted.length - 1]!.playerId, weight: 0, totalWeight };
}
