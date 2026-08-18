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

  /**
   * Ported from the bull-bull engine's tests when that duplicate was deleted (ESTHER_V2 task 2).
   * Niu Niu covered the ladder but not how two hands ON the same rung are separated, nor that the
   * evaluator picks the BEST split of five cards. Both decide who gets paid, so they stay.
   */
  it('breaks a rank tie on the high card', () => {
    // Both land on the same rung — 10 + 2 + 8 = 20, remainder 3 + 6 = Bull 9 — so only the top
    // card separates them, and the king outranks the queen.
    const king = ['Kh', '2d', '3c', '6h', '8d'];
    const queen = ['Qh', '2d', '3c', '6h', '8d'];
    expect(str(king)).toBe(str(queen));
    expect(beats(king, queen)).toBe(true);
    expect(beats(queen, king)).toBe(false);
  });

  it('breaks a rank tie by suit, clubs lowest and spades highest', () => {
    // Same five ranks, same strength, same high card — only the suit of that card differs. Without
    // this the hands are a dead heat, and a dead heat used to be awarded to the banker: a standing
    // edge to whoever held the chair.
    const spade = ['Ks', '2d', '3c', '6h', '8d'];
    const heart = ['Kh', '2d', '3c', '6h', '8d'];
    const diamond = ['Kd', '2s', '3c', '6h', '8h'];
    const club = ['Kc', '2d', '3s', '6h', '8h'];
    expect(beats(spade, heart)).toBe(true);
    expect(beats(heart, diamond)).toBe(true);
    expect(beats(diamond, club)).toBe(true);
  });

  it('never ties two hands against each other', () => {
    // compareNiu returning 0 is what the banker-wins default fed on. No two distinct hands should.
    const a = ['Ks', '2d', '3c', '6h', '8d'];
    const b = ['Kh', '2d', '3c', '6h', '8d'];
    expect(compareNiu(evaluateNiu(a), evaluateNiu(b))).not.toBe(0);
  });

  it('finds the best split of the five cards, not the first one that works', () => {
    // There are ten ways to choose the trio. 5 5 K 3 7: {5,5,K} sums to 20 leaving 3+7 = 10, which
    // is Niu Niu. An evaluator that stopped at a worse partition would score this far lower.
    expect(str(['5h', '5d', 'Kc', '3h', '7d'])).toBe(NiuStrength.NiuNiu);
  });
});
