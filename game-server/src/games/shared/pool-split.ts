/**
 * Pro-rata split of a losing pool across winners, shared by every pari-mutuel game
 * (Cowboy & Beauty, Lottery).
 *
 * Integer division always leaves dust. Rather than let it vanish (money destroyed) or round up
 * (money created), the leftover units are handed out one at a time, biggest stake first — so the
 * winners' gains sum to EXACTLY the losing pool.
 */

export interface Staked {
  playerId: string;
  amount: number;
}

export function proRataSplit(losingPool: number, winners: readonly Staked[]): Map<string, number> {
  const gains = new Map<string, number>();
  const winningPool = winners.reduce((a, w) => a + w.amount, 0);
  if (losingPool <= 0 || winningPool <= 0) return gains;

  let handedOut = 0;
  for (const w of winners) {
    const gain = Math.floor((losingPool * w.amount) / winningPool);
    gains.set(w.playerId, (gains.get(w.playerId) ?? 0) + gain);
    handedOut += gain;
  }

  const order = [...winners].sort(
    (a, b) => b.amount - a.amount || a.playerId.localeCompare(b.playerId),
  );
  for (let i = 0, dust = losingPool - handedOut; dust > 0; i = (i + 1) % order.length, dust--) {
    const p = order[i]!.playerId;
    gains.set(p, gains.get(p)! + 1);
  }
  return gains;
}
