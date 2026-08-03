import { standardDeck, shuffle, shuffledDeck } from '../../src/fairness/shuffle';

describe('deterministic shuffle', () => {
  it('produces a full 52-card permutation (no missing/duplicate cards)', () => {
    const deck = shuffledDeck('a'.repeat(64));
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
    expect([...deck].sort()).toEqual([...standardDeck()].sort());
  });

  it('is deterministic — same seed → identical deck (reproducible by a verifier)', () => {
    const seed = 'deadbeef'.repeat(8);
    expect(shuffledDeck(seed)).toEqual(shuffledDeck(seed));
  });

  it('different seeds produce different decks', () => {
    expect(shuffledDeck('1'.repeat(64))).not.toEqual(shuffledDeck('2'.repeat(64)));
  });

  it('does not mutate the input deck', () => {
    const base = standardDeck();
    const copy = [...base];
    shuffle(base, 'seed');
    expect(base).toEqual(copy);
  });
});
