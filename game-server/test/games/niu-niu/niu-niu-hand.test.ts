import {
  NiuStrength,
  evaluateNiu,
  compareNiu,
} from '../../../src/games/niu-niu/niu-niu-hand';

const str = (c: string[]): number => evaluateNiu(c).strength;
const beats = (a: string[], b: string[]): boolean => compareNiu(evaluateNiu(a), evaluateNiu(b)) > 0;

describe('Niu Niu evaluation', () => {
  it('Niu Niu — three cards ≡0 mod 10 and the other two also', () => {
    // K K K 5 5 → 30 (mult of 10), remainder 10 → Niu Niu
    expect(str(['Kh', 'Kd', 'Kc', '5h', '5d'])).toBe(NiuStrength.NiuNiu);
  });

  it('Bull 7 — trio makes ten, remainder 7', () => {
    // 10 + 5 + 5 = 20; remainder 3 + 4 = 7
    const r = evaluateNiu(['Kh', '5d', '5c', '3h', '4h']);
    expect(r.strength).toBe(7);
    expect(r.multiplier).toBe(2);
  });

  it('No Bull — no trio sums to a multiple of 10', () => {
    expect(str(['2h', '3d', '4c', '6h', '8d'])).toBe(NiuStrength.NoBull);
  });

  it('special hands: bomb, five flowers, five small', () => {
    expect(str(['7h', '7d', '7c', '7s', '2h'])).toBe(NiuStrength.Bomb); // four of a kind
    expect(str(['Jh', 'Jd', 'Qc', 'Kh', 'Kd'])).toBe(NiuStrength.FiveFlowers); // all J/Q/K
    expect(str(['Ah', 'Ad', '2c', '3h', '3d'])).toBe(NiuStrength.FiveSmall); // all ≤4, total 10
  });

  it('orders the strength ladder', () => {
    const noBull = ['2h', '3d', '4c', '6h', '8d'];
    const bull7 = ['Kh', '5d', '5c', '3h', '4h'];
    const niuNiu = ['Kh', 'Kd', 'Kc', '5h', '5d'];
    const bomb = ['7h', '7d', '7c', '7s', '2h'];
    const flowers = ['Jh', 'Jd', 'Qc', 'Kh', 'Kd'];
    const small = ['Ah', 'Ad', '2c', '3h', '3d'];
    expect(beats(bull7, noBull)).toBe(true);
    expect(beats(niuNiu, bull7)).toBe(true);
    expect(beats(bomb, niuNiu)).toBe(true);
    expect(beats(flowers, bomb)).toBe(true);
    expect(beats(small, flowers)).toBe(true);
  });

  it('carries the payout multiplier up the ladder', () => {
    expect(evaluateNiu(['Kh', 'Kd', 'Kc', '5h', '5d']).multiplier).toBe(4); // niu niu
    expect(evaluateNiu(['Ah', 'Ad', '2c', '3h', '3d']).multiplier).toBe(6); // five small
  });
});
