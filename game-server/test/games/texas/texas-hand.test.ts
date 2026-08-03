import { TexasHand } from '../../../src/games/texas/texas-hand';
import { compareHands } from '../../../src/games/texas/hand-evaluator';

function makePlayers(n: number, stack = 1000): { id: string; stack: number }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, stack }));
}

/** Play the current street out passively (everyone checks, or calls if facing a bet). */
function playStreet(g: TexasHand): void {
  const street = g.street;
  while (!g.isComplete && g.street === street) {
    const la = g.legalActions();
    g.act(g.toAct!, la.canCheck ? { type: 'check' } : { type: 'call' });
  }
}

function totalChips(g: TexasHand): number {
  return [...g.finalStacks().values()].reduce((s, v) => s + v, 0);
}

describe('TexasHand — a full hand', () => {
  it('deals 2 hole cards each + 5 community, all distinct', () => {
    const players = makePlayers(3);
    const g = new TexasHand(players, { seed: 'seed-distinct', smallBlind: 5, bigBlind: 10 });
    const all = new Set<string>();
    for (const p of players) {
      const hole = g.holeCardsFor(p.id)!;
      expect(hole).toHaveLength(2);
      hole.forEach((c) => all.add(c));
    }
    // Play to showdown to reveal all community.
    while (!g.isComplete) playStreet(g);
    g.getResult()!.community.forEach((c) => all.add(c));
    expect(all.size).toBe(3 * 2 + 5); // no duplicate cards
  });

  it('reveals community cards progressively per street', () => {
    const g = new TexasHand(makePlayers(3), { seed: 'seed-reveal', smallBlind: 5, bigBlind: 10 });
    expect(g.community()).toHaveLength(0); // preflop
    playStreet(g);
    expect(g.community()).toHaveLength(3); // flop
    playStreet(g);
    expect(g.community()).toHaveLength(4); // turn
    playStreet(g);
    expect(g.community()).toHaveLength(5); // river
  });

  it('runs to showdown, conserves chips, and pays the best hand', () => {
    const g = new TexasHand(makePlayers(3), { seed: 'seed-showdown', smallBlind: 5, bigBlind: 10 });
    while (!g.isComplete) playStreet(g);

    const res = g.getResult()!;
    expect(res.community).toHaveLength(5);
    expect(res.showdown.length).toBeGreaterThanOrEqual(2);

    // Chips conserved: nothing created or destroyed.
    expect(totalChips(g)).toBe(3 * 1000);
    // Payouts sum to the pot (everyone limped for 10).
    const paid = [...res.payouts.values()].reduce((s, v) => s + v, 0);
    expect(paid).toBe(30);

    // The pot went to the best showdown hand.
    const best = [...res.showdown].sort((a, b) => compareHands(b.rank, a.rank))[0]!;
    expect(res.payouts.get(best.id)).toBeGreaterThan(0);
  });
});

describe('TexasHand — fold win', () => {
  it('awards the pot to the last player when everyone folds', () => {
    const g = new TexasHand(makePlayers(3), { seed: 'seed-fold', smallBlind: 5, bigBlind: 10 });
    g.act('p0', { type: 'fold' });
    g.act('p1', { type: 'fold' });
    const res = g.getResult()!;
    expect(res.showdown).toHaveLength(0); // no cards shown
    expect(res.payouts.get('p2')).toBe(15); // blinds
    expect(g.community()).toHaveLength(0);
    expect(totalChips(g)).toBe(3 * 1000);
  });
});

describe('TexasHand — all-in runout', () => {
  it('runs out the board and settles when players are all-in', () => {
    const g = new TexasHand(makePlayers(2, 100), { seed: 'seed-allin', smallBlind: 5, bigBlind: 10 });
    g.act('p0', { type: 'raise', amount: 100 }); // shove
    g.act('p1', { type: 'call' }); // call all-in
    const res = g.getResult()!;
    expect(g.street).toBe('SHOWDOWN');
    expect(res.community).toHaveLength(5);
    expect(totalChips(g)).toBe(200); // conserved
    const paid = [...res.payouts.values()].reduce((s, v) => s + v, 0);
    expect(paid).toBe(200);
  });
});

describe('TexasHand — determinism', () => {
  it('same seed → same deal', () => {
    const a = new TexasHand(makePlayers(3), { seed: 'same', smallBlind: 5, bigBlind: 10 });
    const b = new TexasHand(makePlayers(3), { seed: 'same', smallBlind: 5, bigBlind: 10 });
    expect(a.holeCardsFor('p0')).toEqual(b.holeCardsFor('p0'));
    expect(a.holeCardsFor('p2')).toEqual(b.holeCardsFor('p2'));
  });
});
