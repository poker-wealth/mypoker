import { ComboType, classifyPlay, beats, type Combo } from '../../../src/games/dou-di-zhu/combos';

const c = (ranks: number[]): Combo | null => classifyPlay(ranks);
const t = (ranks: number[]): ComboType | undefined => classifyPlay(ranks)?.type;

describe('Dou Di Zhu — classification', () => {
  it('classifies the basic shapes', () => {
    expect(t([5])).toBe(ComboType.Single);
    expect(t([7, 7])).toBe(ComboType.Pair);
    expect(t([9, 9, 9])).toBe(ComboType.Triple);
    expect(t([9, 9, 9, 5])).toBe(ComboType.TripleOne);
    expect(t([9, 9, 9, 5, 5])).toBe(ComboType.TripleTwo);
    expect(t([6, 6, 6, 6])).toBe(ComboType.Bomb);
    expect(t([16, 17])).toBe(ComboType.Rocket);
  });

  it('classifies sequences (only 3..A allowed)', () => {
    expect(c([3, 4, 5, 6, 7])).toMatchObject({ type: ComboType.Straight, rank: 7, length: 5 });
    expect(t([3, 3, 4, 4, 5, 5])).toBe(ComboType.PairStraight);
    expect(t([7, 7, 7, 8, 8, 8])).toBe(ComboType.Airplane);
    expect(t([7, 7, 7, 8, 8, 8, 3, 4])).toBe(ComboType.AirplaneSingles);
    expect(t([7, 7, 7, 8, 8, 8, 3, 3, 4, 4])).toBe(ComboType.AirplanePairs);
    // A 2 cannot be in a straight.
    expect(c([11, 12, 13, 14, 15])).toBeNull();
    // Straights need at least 5 cards.
    expect(c([3, 4, 5, 6])).toBeNull();
  });

  it('classifies four-with-two (not a bomb)', () => {
    expect(t([9, 9, 9, 9, 3, 4])).toBe(ComboType.FourTwoSingles);
    expect(t([9, 9, 9, 9, 3, 3, 4, 4])).toBe(ComboType.FourTwoPairs);
  });

  it('rejects illegal shapes', () => {
    expect(c([3, 4])).toBeNull(); // two different singles
    expect(c([3, 3, 4])).toBeNull(); // pair + odd single
    expect(c([7, 7, 7, 8, 9])).toBeNull(); // triple + two DIFFERENT singles (三带二 needs a pair)
  });
});

describe('Dou Di Zhu — beats()', () => {
  const combo = (ranks: number[]): Combo => classifyPlay(ranks)!;

  it('same shape, higher rank wins', () => {
    expect(beats(combo([5]), combo([7]))).toBe(true);
    expect(beats(combo([7]), combo([5]))).toBe(false);
    expect(beats(combo([5, 5]), combo([9, 9]))).toBe(true);
  });

  it('straights must match length', () => {
    expect(beats(combo([3, 4, 5, 6, 7]), combo([4, 5, 6, 7, 8]))).toBe(true); // higher, same length
    expect(beats(combo([3, 4, 5, 6, 7]), combo([4, 5, 6, 7, 8, 9]))).toBe(false); // different length
  });

  it('a bomb beats any non-bomb; a bigger bomb beats a bomb', () => {
    expect(beats(combo([3, 4, 5, 6, 7]), combo([6, 6, 6, 6]))).toBe(true); // bomb > straight
    expect(beats(combo([9, 9]), combo([6, 6, 6, 6]))).toBe(true);
    expect(beats(combo([6, 6, 6, 6]), combo([9, 9]))).toBe(false); // non-bomb can't beat bomb
    expect(beats(combo([6, 6, 6, 6]), combo([9, 9, 9, 9]))).toBe(true); // bigger bomb
  });

  it('a rocket beats everything, including bombs', () => {
    expect(beats(combo([9, 9, 9, 9]), combo([16, 17]))).toBe(true);
    expect(beats(combo([16, 17]), combo([9, 9, 9, 9]))).toBe(false);
  });

  it('four-with-two is not a bomb — it cannot beat a bomb or a straight', () => {
    expect(beats(combo([6, 6, 6, 6]), combo([9, 9, 9, 9, 3, 4]))).toBe(false); // vs a real bomb
    expect(beats(combo([3, 4, 5, 6, 7]), combo([9, 9, 9, 9, 3, 4]))).toBe(false); // different type
  });

  it('different shapes do not beat each other', () => {
    expect(beats(combo([5]), combo([7, 7]))).toBe(false); // pair can't beat single
  });
});
