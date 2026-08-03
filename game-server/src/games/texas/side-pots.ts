import { compareHands, type HandRank } from './hand-evaluator';

/**
 * Side-pot construction and showdown distribution.
 *
 * From each player's total contribution we peel off "betting layers": the smallest contribution
 * forms a pot every contributor shares, then we subtract it and repeat. Folded players' chips stay
 * in the pots as dead money (they can't win); a lone over-bettor at the top layer simply wins their
 * own uncalled chips back. Each pot is awarded to the best eligible hand(s), ties split evenly with
 * odd chips going to the earliest seat.
 */

export interface Pot {
  amount: number;
  /** Players eligible to win this pot (contributed to this layer and did not fold). */
  eligible: string[];
}

export interface ShowdownResult {
  pots: Pot[];
  payouts: Map<string, number>;
}

/** Build the main + side pots from contributions. `seatOrder` gives deterministic ordering. */
export function buildPots(
  contributions: Map<string, number>,
  notFolded: readonly string[],
  seatOrder: readonly string[],
): Pot[] {
  const notFoldedSet = new Set(notFolded);
  const orderIndex = (p: string): number => {
    const i = seatOrder.indexOf(p);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };

  const remaining = new Map<string, number>();
  for (const [p, amt] of contributions) if (amt > 0) remaining.set(p, amt);

  const raw: Pot[] = [];
  for (;;) {
    const contributors = [...remaining.entries()].filter(([, a]) => a > 0).map(([p]) => p);
    if (contributors.length === 0) break;
    const minLayer = Math.min(...contributors.map((p) => remaining.get(p)!));
    const amount = minLayer * contributors.length;
    const eligible = contributors
      .filter((p) => notFoldedSet.has(p))
      .sort((a, b) => orderIndex(a) - orderIndex(b));
    raw.push({ amount, eligible });
    for (const p of contributors) remaining.set(p, remaining.get(p)! - minLayer);
  }

  return mergePots(raw);
}

/** Merge adjacent layers with the same eligible set; fold dead (empty-eligible) layers backward. */
function mergePots(raw: Pot[]): Pot[] {
  const merged: Pot[] = [];
  for (const pot of raw) {
    const prev = merged[merged.length - 1];
    if (pot.eligible.length === 0 && prev) {
      prev.amount += pot.amount; // dead money attaches to the pot beneath it
    } else if (prev && sameSet(prev.eligible, pot.eligible)) {
      prev.amount += pot.amount;
    } else {
      merged.push({ amount: pot.amount, eligible: [...pot.eligible] });
    }
  }
  return merged;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Award one pot to the best eligible hand(s); split ties, odd chips to the earliest seat. */
export function distributePot(
  pot: Pot,
  hands: Map<string, HandRank>,
  seatOrder: readonly string[],
): Map<string, number> {
  const payouts = new Map<string, number>();
  let best: HandRank | undefined;
  let winners: string[] = [];
  for (const p of pot.eligible) {
    const h = hands.get(p);
    if (!h) continue;
    if (!best || compareHands(h, best) > 0) {
      best = h;
      winners = [p];
    } else if (compareHands(h, best) === 0) {
      winners.push(p);
    }
  }
  if (winners.length === 0) return payouts;

  winners.sort((a, b) => seatOrder.indexOf(a) - seatOrder.indexOf(b));
  const base = Math.floor(pot.amount / winners.length);
  let odd = pot.amount - base * winners.length;
  for (const w of winners) {
    payouts.set(w, base + (odd > 0 ? 1 : 0));
    if (odd > 0) odd--;
  }
  return payouts;
}

/** Full showdown: build pots, distribute each, and total the payouts per player. */
export function settleShowdown(input: {
  contributions: Map<string, number>;
  notFolded: readonly string[];
  hands: Map<string, HandRank>;
  seatOrder: readonly string[];
}): ShowdownResult {
  const pots = buildPots(input.contributions, input.notFolded, input.seatOrder);
  const payouts = new Map<string, number>();
  for (const pot of pots) {
    for (const [player, amount] of distributePot(pot, input.hands, input.seatOrder)) {
      payouts.set(player, (payouts.get(player) ?? 0) + amount);
    }
  }
  return { pots, payouts };
}
