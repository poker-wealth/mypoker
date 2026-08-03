import {
  SanZhangCategory,
  evaluate3,
  compare3,
} from '../../../src/games/san-zhang/san-zhang-hand';

const cat = (c: string[]): SanZhangCategory => evaluate3(c).category;
const beats = (a: string[], b: string[]): boolean => compare3(evaluate3(a), evaluate3(b)) > 0;

describe('San Zhang 3-card evaluation', () => {
  it('detects each category', () => {
    expect(cat(['9h', '9d', '9c'])).toBe(SanZhangCategory.ThreeOfAKind);
    expect(cat(['9h', '8h', '7h'])).toBe(SanZhangCategory.StraightFlush);
    expect(cat(['Ah', '9h', '2h'])).toBe(SanZhangCategory.Flush);
    expect(cat(['9h', '8d', '7c'])).toBe(SanZhangCategory.Straight);
    expect(cat(['Jh', 'Jd', '5c'])).toBe(SanZhangCategory.Pair);
    expect(cat(['Ah', '9d', '2c'])).toBe(SanZhangCategory.HighCard);
  });

  it('ranks three-of-a-kind ABOVE a straight flush (Zha Jin Hua order)', () => {
    const trips = ['2h', '2d', '2c']; // even low trips
    const straightFlush = ['Ah', 'Kh', 'Qh']; // top straight flush
    expect(beats(trips, straightFlush)).toBe(true);
  });

  it('orders the full chain', () => {
    const chain = [
      ['9h', '9d', '9c'], // trips
      ['9h', '8h', '7h'], // straight flush
      ['Ah', '9h', '2h'], // flush
      ['9h', '8d', '7c'], // straight
      ['Jh', 'Jd', '5c'], // pair
      ['Ah', '9d', '2c'], // high
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(beats(chain[i]!, chain[i + 1]!)).toBe(true);
    }
  });

  it('handles the A-2-3 wheel as the lowest straight', () => {
    expect(evaluate3(['Ah', '2d', '3c']).tiebreak).toEqual([3]);
    expect(beats(['4h', '3d', '2c'], ['Ah', '2d', '3c'])).toBe(true); // 2-3-4 beats wheel
    expect(evaluate3(['Qh', 'Kd', 'Ac']).tiebreak).toEqual([14]); // Q-K-A is ace-high straight
  });

  it('breaks ties by kicker / rank', () => {
    expect(beats(['Ah', 'Ad', 'Kc'], ['Ah', 'Ad', 'Qc'])).toBe(true); // pair kicker
    expect(beats(['Ah', '9h', '3h'], ['Kh', '9h', '3h'])).toBe(true); // flush high card
    expect(beats(['Ah', 'Ad', 'Ac'], ['Kh', 'Kd', 'Kc'])).toBe(true); // higher trips
  });

  it('returns a tie for identical ranks in different suits', () => {
    expect(compare3(evaluate3(['Ah', '9d', '2c']), evaluate3(['As', '9c', '2h']))).toBe(0);
  });
});
