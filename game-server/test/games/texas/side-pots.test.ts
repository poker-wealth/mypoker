import { distributePot, settleShowdown } from '../../../src/games/texas/side-pots';
import { HandCategory, type HandRank } from '../../../src/games/texas/hand-evaluator';

/** A stand-in hand whose strength is a single score — isolates pot logic from card specifics. */
const hand = (score: number): HandRank => ({
  category: HandCategory.HighCard,
  tiebreak: [score],
  cards: [],
});

describe('side pots — simple distribution', () => {
  it('awards the whole pot to the best hand', () => {
    const { payouts } = settleShowdown({
      contributions: new Map([['p0', 100], ['p1', 100], ['p2', 100]]),
      notFolded: ['p0', 'p1', 'p2'],
      hands: new Map([['p0', hand(5)], ['p1', hand(9)], ['p2', hand(3)]]),
      seatOrder: ['p0', 'p1', 'p2'],
    });
    expect(payouts.get('p1')).toBe(300);
    expect(payouts.get('p0')).toBeUndefined();
  });

  it('splits a tie evenly, odd chip to the earliest seat', () => {
    const pot = { amount: 101, eligible: ['p0', 'p1'] };
    const payouts = distributePot(pot, new Map([['p0', hand(7)], ['p1', hand(7)]]), ['p0', 'p1']);
    expect(payouts.get('p0')).toBe(51); // earlier seat gets the odd chip
    expect(payouts.get('p1')).toBe(50);
  });
});

describe('side pots — all-in layering', () => {
  it('builds a main pot + side pot and pays each to its best eligible hand', () => {
    // A is all-in for 50; B and C put in 200 each.
    const result = settleShowdown({
      contributions: new Map([['A', 50], ['B', 200], ['C', 200]]),
      notFolded: ['A', 'B', 'C'],
      hands: new Map([['A', hand(30)], ['B', hand(20)], ['C', hand(10)]]), // A best overall
      seatOrder: ['A', 'B', 'C'],
    });
    expect(result.pots).toHaveLength(2);
    expect(result.pots[0]).toEqual({ amount: 150, eligible: ['A', 'B', 'C'] }); // main
    expect(result.pots[1]).toEqual({ amount: 300, eligible: ['B', 'C'] }); // side
    // A can only win the main pot (was all-in); the side pot goes to the better of B/C.
    expect(result.payouts.get('A')).toBe(150);
    expect(result.payouts.get('B')).toBe(300);
    expect(result.payouts.get('C')).toBeUndefined();
  });
});

describe('side pots — dead money & uncalled bets', () => {
  it('keeps a folder\'s chips in the pot as dead money', () => {
    const { payouts } = settleShowdown({
      contributions: new Map([['A', 100], ['B', 100], ['C', 10]]), // C folded after posting
      notFolded: ['A', 'B'],
      hands: new Map([['A', hand(9)], ['B', hand(4)]]),
      seatOrder: ['A', 'B', 'C'],
    });
    expect(payouts.get('A')).toBe(210); // 100 + 100 + C's dead 10
  });

  it('returns an uncalled over-bet to the bettor', () => {
    // A bet 200 but B could only call 50 (all-in). A's extra 150 is uncalled.
    const { pots, payouts } = settleShowdown({
      contributions: new Map([['A', 200], ['B', 50]]),
      notFolded: ['A', 'B'],
      hands: new Map([['A', hand(1)], ['B', hand(9)]]), // B wins the contested pot
      seatOrder: ['A', 'B'],
    });
    expect(pots[0]).toEqual({ amount: 100, eligible: ['A', 'B'] }); // contested
    expect(pots[1]).toEqual({ amount: 150, eligible: ['A'] }); // uncalled, returned
    expect(payouts.get('B')).toBe(100); // B wins the contested pot
    expect(payouts.get('A')).toBe(150); // A gets the uncalled bet back
  });

  it('a single non-folded player scoops everything', () => {
    const { payouts } = settleShowdown({
      contributions: new Map([['A', 30], ['B', 70]]),
      notFolded: ['B'],
      hands: new Map([['B', hand(2)]]),
      seatOrder: ['A', 'B'],
    });
    expect(payouts.get('B')).toBe(100);
  });
});
