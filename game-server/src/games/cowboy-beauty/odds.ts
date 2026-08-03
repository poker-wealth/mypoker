/**
 * Cowboy & Beauty — pari-mutuel pool math.
 *
 * There is no banker: the two sides' bets form one pool, and the winning side splits the losing
 * side's stakes pro-rata. The platform is never counterparty and carries no exposure — it takes only
 * a rake at settlement. The displayed odds are implied by the pools, so they move as bets arrive,
 * which is exactly why they must FREEZE before the draw (see cowboy-beauty-game.ts).
 */

import { proRataSplit } from '../shared/pool-split';

export type Side = 'COWBOY' | 'BEAUTY';
export const SIDES: readonly Side[] = ['COWBOY', 'BEAUTY'];

export interface PoolBet {
  playerId: string;
  side: Side;
  amount: number;
}

export type PoolTotals = Record<Side, number>;

export function poolTotals(bets: readonly PoolBet[]): PoolTotals {
  const pools: PoolTotals = { COWBOY: 0, BEAUTY: 0 };
  for (const b of bets) pools[b.side] += b.amount;
  return pools;
}

/**
 * Decimal odds in basis points: total pool ÷ that side's pool (10000 bps = 1.00×).
 * `null` when nobody has backed a side yet (no odds exist).
 */
export function impliedOddsBps(pools: PoolTotals): Record<Side, number | null> {
  const total = pools.COWBOY + pools.BEAUTY;
  const odds = (sidePool: number): number | null =>
    sidePool === 0 ? null : Math.floor((total * 10000) / sidePool);
  return { COWBOY: odds(pools.COWBOY), BEAUTY: odds(pools.BEAUTY) };
}

/**
 * GROSS nets for the round (sum exactly zero — the rake is applied later by settleNet).
 * Winners split the losing pool pro-rata by stake; losers forfeit their stake.
 * Returns an empty map (round void, everyone refunded) when nobody backed the winning side.
 */
export function distributePool(bets: readonly PoolBet[], winner: Side): Map<string, number> {
  const pools = poolTotals(bets);
  const winningPool = pools[winner];
  const losingPool = pools[winner === 'COWBOY' ? 'BEAUTY' : 'COWBOY'];
  // Nobody backed the winner (or nobody backed the loser) → nothing to distribute; void/refund.
  if (winningPool === 0 || losingPool === 0) return new Map();

  const net = proRataSplit(
    losingPool,
    bets.filter((b) => b.side === winner),
  );
  for (const b of bets) if (b.side !== winner) net.set(b.playerId, -b.amount);
  return net;
}
