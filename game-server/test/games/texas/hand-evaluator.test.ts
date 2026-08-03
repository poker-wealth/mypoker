import {
  HandCategory,
  evaluateFive,
  evaluateBest,
  compareHands,
} from '../../../src/games/texas/hand-evaluator';

const cat = (cards: string[]): HandCategory => evaluateFive(cards).category;
const beats = (a: string[], b: string[]): boolean =>
  compareHands(evaluateFive(a), evaluateFive(b)) > 0;

describe('hand evaluator — category detection', () => {
  it('identifies every category from a 5-card hand', () => {
    expect(cat(['As', 'Ks', 'Qs', 'Js', 'Ts'])).toBe(HandCategory.StraightFlush); // royal
    expect(cat(['9h', '9d', '9c', '9s', 'Kd'])).toBe(HandCategory.FourOfAKind);
    expect(cat(['8h', '8d', '8c', 'Kh', 'Kd'])).toBe(HandCategory.FullHouse);
    expect(cat(['Ah', '9h', '7h', '4h', '2h'])).toBe(HandCategory.Flush);
    expect(cat(['9h', '8d', '7c', '6s', '5h'])).toBe(HandCategory.Straight);
    expect(cat(['Qh', 'Qd', 'Qc', '9s', '2h'])).toBe(HandCategory.ThreeOfAKind);
    expect(cat(['Ah', 'Ad', 'Kc', 'Ks', '2h'])).toBe(HandCategory.TwoPair);
    expect(cat(['Jh', 'Jd', '9c', '6s', '2h'])).toBe(HandCategory.Pair);
    expect(cat(['Ah', 'Kd', '9c', '6s', '2h'])).toBe(HandCategory.HighCard);
  });

  it('recognizes the wheel (A-2-3-4-5) as a 5-high straight', () => {
    const wheel = evaluateFive(['Ah', '2d', '3c', '4s', '5h']);
    expect(wheel.category).toBe(HandCategory.Straight);
    expect(wheel.tiebreak).toEqual([5]); // ace plays low
    // A 6-high straight beats the wheel.
    expect(beats(['6h', '5d', '4c', '3s', '2h'], ['Ah', '2d', '3c', '4s', '5h'])).toBe(true);
  });
});

describe('hand evaluator — ranking chain', () => {
  it('orders the categories strictly', () => {
    const sf = ['9h', '8h', '7h', '6h', '5h'];
    const quads = ['9h', '9d', '9c', '9s', 'Kd'];
    const fh = ['8h', '8d', '8c', 'Kh', 'Kd'];
    const flush = ['Ah', '9h', '7h', '4h', '2h'];
    const straight = ['9h', '8d', '7c', '6s', '5h'];
    const trips = ['Qh', 'Qd', 'Qc', '9s', '2h'];
    const twoPair = ['Ah', 'Ad', 'Kc', 'Ks', '2h'];
    const pair = ['Jh', 'Jd', '9c', '6s', '2h'];
    const high = ['Ah', 'Kd', '9c', '6s', '2h'];
    const chain = [sf, quads, fh, flush, straight, trips, twoPair, pair, high];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(beats(chain[i]!, chain[i + 1]!)).toBe(true);
    }
  });
});

describe('hand evaluator — tiebreaks', () => {
  it('breaks pairs by kicker', () => {
    expect(beats(['Ah', 'Ad', 'Kc', '5s', '2h'], ['Ah', 'Ad', 'Qc', '5s', '2h'])).toBe(true);
  });

  it('breaks two pair by top pair, then bottom, then kicker', () => {
    expect(beats(['Ah', 'Ad', '3c', '3s', '2h'], ['Kh', 'Kd', 'Qc', 'Qs', '2h'])).toBe(true);
    expect(beats(['Ah', 'Ad', 'Kc', 'Ks', 'Qh'], ['Ah', 'Ad', 'Kc', 'Ks', '2h'])).toBe(true);
  });

  it('breaks full houses by the trip rank', () => {
    expect(beats(['Ah', 'Ad', 'Ac', '2s', '2h'], ['Kh', 'Kd', 'Kc', 'Qs', 'Qh'])).toBe(true);
  });

  it('breaks flushes by high cards', () => {
    expect(beats(['Ah', 'Qh', '7h', '4h', '2h'], ['Kh', 'Qh', '7h', '4h', '2h'])).toBe(true);
  });

  it('returns a tie for identical ranks in different suits', () => {
    expect(compareHands(evaluateFive(['Ah', 'Kd', '9c', '6s', '2h']), evaluateFive(['As', 'Kc', '9d', '6h', '2s']))).toBe(0);
  });
});

describe('hand evaluator — best 5 of 7', () => {
  it('picks a royal flush out of 7 cards', () => {
    const r = evaluateBest(['As', 'Ks', 'Qs', 'Js', 'Ts', '2h', '3d']);
    expect(r.category).toBe(HandCategory.StraightFlush);
    expect(r.tiebreak).toEqual([14]);
  });

  it('finds quads + the best kicker', () => {
    const r = evaluateBest(['Ah', 'Ad', 'Ac', 'As', 'Kh', 'Kd', '2c']);
    expect(r.category).toBe(HandCategory.FourOfAKind);
    expect(r.tiebreak).toEqual([14, 13]); // four aces, king kicker
  });

  it('finds a full house using two pairs + a trip on the board', () => {
    const r = evaluateBest(['Ah', 'Ad', 'Ac', 'Kh', 'Kd', '5s', '2c']);
    expect(r.category).toBe(HandCategory.FullHouse);
    expect(r.tiebreak).toEqual([14, 13]);
  });

  it('resolves a realistic showdown (board + two players)', () => {
    const board = ['Kh', '9d', '4c', '4s', '2h'];
    const p1 = evaluateBest([...board, 'Ah', 'Kd']); // two pair: K K 4 4, A kicker
    const p2 = evaluateBest([...board, '9h', '9c']); // full house: 9 9 9 4 4
    expect(p2.category).toBe(HandCategory.FullHouse);
    expect(compareHands(p2, p1)).toBeGreaterThan(0);
  });
});
