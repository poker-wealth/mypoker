import { findAllLegalMoves } from '../../../src/games/dou-di-zhu/ai';
import { validateMove } from '../../../src/games/dou-di-zhu/validator';
import { classifyCards, ComboType, beats, type Combo } from '../../../src/games/dou-di-zhu/combos';
import { build54Deck, cardRank } from '../../../src/games/dou-di-zhu/ddz-deck';

/**
 * The AI's move generator, checked against MANY hands rather than a few chosen
 * ones.
 *
 * The existing suite asks whether it can beat an airplane with a bigger
 * airplane — a scenario someone thought of. This asks the two questions that
 * hold on every hand:
 *
 *   SOUND       every move it offers is legal and held. An illegal suggestion
 *               is the worse failure: the validator refuses it, so the bot
 *               stalls or throws mid-hand rather than merely playing badly.
 *
 *   COMPLETE    it never passes while holding an answer. Checked exactly, not
 *               approximately, for the shapes whose legal answers can be
 *               enumerated directly — singles, pairs, triples, bombs, rocket.
 *               Those are also the shapes that occur most, so a gap there is a
 *               bot that folds winning hands.
 *
 * Deterministic despite being broad: the deals come from a seeded shuffle, so a
 * failure names a specific hand and reproduces on every run.
 */

/** Mulberry32 — a small seeded PRNG, so "random" deals are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deal(seed: number, size: number): string[] {
  const deck = build54Deck();
  const rand = rng(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck.slice(0, size);
}

const combo = (cards: string[]): Combo => {
  const c = classifyCards(cards, cardRank);
  if (!c) throw new Error(`not a legal combination: ${cards.join(' ')}`);
  return c;
};

/** Every previous-play shape the generator has to answer. */
const PREVIOUS: { label: string; cards: string[] }[] = [
  { label: 'single', cards: ['9c'] },
  { label: 'pair', cards: ['9c', '9d'] },
  { label: 'triple', cards: ['9c', '9d', '9h'] },
  { label: 'triple+1', cards: ['9c', '9d', '9h', '4s'] },
  { label: 'triple+2', cards: ['9c', '9d', '9h', '4s', '4c'] },
  { label: 'straight', cards: ['4c', '5c', '6c', '7c', '8c'] },
  { label: 'pair-straight', cards: ['4c', '4d', '5c', '5d', '6c', '6d'] },
  { label: 'airplane', cards: ['7c', '7d', '7h', '8c', '8d', '8h'] },
  { label: 'bomb', cards: ['9c', '9d', '9h', '9s'] },
  { label: 'four+2-singles', cards: ['9c', '9d', '9h', '9s', '3c', '4c'] },
  { label: 'four+2-pairs', cards: ['9c', '9d', '9h', '9s', '3c', '3d', '4c', '4d'] },
];

/**
 * Four-with-two, pinned separately because its absence was invisible.
 *
 * The generator skipped the shape entirely. Nothing looked broken: holding a
 * higher quad it answered with the BOMB, which is legal and beats a
 * four-with-two — so the bot never stalled and no test failed. What it did
 * instead was double the round multiplier every time (dou-di-zhu-game.ts),
 * paying out twice the stake to answer a play that costs nothing to answer in
 * kind. A losing bot is a bug report; a bot that silently doubles the pot is a
 * money bug.
 */
describe('DDZ AI — four-with-two', () => {
  const quadPlusSpares = ['9c', '9d', '9h', '9s', 'Kc', 'Qd', '7h'];

  it('answers a four-with-two in kind, not only by detonating the quad', () => {
    const prev = combo(['5c', '5d', '5h', '5s', '3c', '4c']);
    const moves = findAllLegalMoves(quadPlusSpares, prev);
    expect(moves.some((m) => m.combo.type === ComboType.FourTwoSingles)).toBe(true);
  });

  it('answers four-with-two-pairs in kind', () => {
    const prev = combo(['5c', '5d', '5h', '5s', '3c', '3d', '4c', '4d']);
    const hand = ['9c', '9d', '9h', '9s', 'Kc', 'Kd', 'Qc', 'Qd'];
    const moves = findAllLegalMoves(hand, prev);
    expect(moves.some((m) => m.combo.type === ComboType.FourTwoPairs)).toBe(true);
  });

  it('can lead one, so a quad can shed two dead cards', () => {
    const kinds = new Set(findAllLegalMoves(quadPlusSpares, null).map((m) => m.combo.type));
    expect(kinds.has(ComboType.FourTwoSingles)).toBe(true);
  });

  it('does not offer one when the quad is the whole hand', () => {
    const moves = findAllLegalMoves(['9c', '9d', '9h', '9s'], null);
    expect(moves.some((m) => m.combo.type === ComboType.FourTwoSingles)).toBe(false);
  });
});

describe('DDZ AI — every move it offers is legal (soundness)', () => {
  // 20 cards is a landlord's hand: the largest, and the most shapes available.
  it.each(PREVIOUS)('answering a $label, across 60 seeded hands', ({ cards }) => {
    const previous = combo(cards);

    for (let seed = 1; seed <= 60; seed++) {
      const hand = deal(seed, 20);
      for (const move of findAllLegalMoves(hand, previous)) {
        const result = validateMove(move.cards, previous, hand);
        if (!result.valid) {
          throw new Error(
            `seed ${seed}: offered an illegal move ${move.cards.join(' ')} ` +
              `(${move.combo.type}) against ${cards.join(' ')} — ${result.reason}`,
          );
        }
      }
    }
  });

  it('offers nothing it does not hold, leading or answering', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const hand = deal(seed, 20);
      for (const previous of [null, combo(['9c'])]) {
        for (const move of findAllLegalMoves(hand, previous)) {
          const pool = [...hand];
          for (const card of move.cards) {
            const i = pool.indexOf(card);
            expect(i).toBeGreaterThanOrEqual(0); // held, and not double-counted
            pool.splice(i, 1);
          }
        }
      }
    }
  });
});

describe('DDZ AI — it never passes while holding an answer (completeness)', () => {
  const ranksOf = (hand: string[]): Map<number, string[]> => {
    const m = new Map<number, string[]>();
    for (const c of hand) {
      const r = cardRank(c);
      m.set(r, [...(m.get(r) ?? []), c]);
    }
    return m;
  };

  /**
   * Shapes whose complete answer set can be derived directly: every rank
   * strictly above the previous one holding enough cards. No search, so this is
   * ground truth rather than a second implementation of the AI.
   */
  const CASES: { label: string; previous: string[]; need: number }[] = [
    { label: 'a single', previous: ['9c'], need: 1 },
    { label: 'a pair', previous: ['9c', '9d'], need: 2 },
    { label: 'a triple', previous: ['9c', '9d', '9h'], need: 3 },
  ];

  it.each(CASES)('finds a higher $label whenever one is held', ({ previous, need }) => {
    const prev = combo(previous);
    const prevRank = cardRank(previous[0]!);

    for (let seed = 1; seed <= 80; seed++) {
      // 10 cards: small enough that a hand often CANNOT answer, which is what
      // makes "it passed" a meaningful thing to check.
      const hand = deal(seed, 10);
      const byRank = ranksOf(hand);

      const shouldAnswer = [...byRank.entries()].some(
        ([r, cs]) => r > prevRank && cs.length >= need && r <= 15, // jokers are not pairs/triples
      );
      const moves = findAllLegalMoves(hand, prev);
      // Bombs and the rocket beat anything, so their presence also explains a
      // non-empty result — exclude them when judging "found the plain answer".
      const plain = moves.filter(
        (m) => m.combo.type !== ComboType.Bomb && m.combo.type !== ComboType.Rocket,
      );

      if (shouldAnswer) {
        expect(plain.length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Runs — straights and pair-straights — are the shapes a generator most
   * plausibly misses, because finding them means sliding a window over the
   * ranks rather than counting one rank at a time. Ground truth here is the
   * window scan done directly: 2 and the jokers cannot appear in a run
   * (RANK_VALUE puts them at 15/16/17), so the search stops at A=14.
   */
  const RUNS: { label: string; previous: string[]; span: number; copies: number }[] = [
    { label: 'a 5-straight', previous: ['4c', '5c', '6c', '7c', '8c'], span: 5, copies: 1 },
    {
      label: 'a 3-pair straight',
      previous: ['4c', '4d', '5c', '5d', '6c', '6d'],
      span: 3,
      copies: 2,
    },
  ];

  it.each(RUNS)('finds a higher $label whenever one is held', ({ previous, span, copies }) => {
    const prev = combo(previous);
    const prevLow = cardRank(previous[0]!);
    let answered = 0;

    for (let seed = 1; seed <= 120; seed++) {
      // 20 cards — a run needs enough cards to exist at all, so the smaller
      // hands used above would make this test mostly vacuous.
      const hand = deal(seed, 20);
      const byRank = ranksOf(hand);

      // Every start strictly above the previous run's low card whose whole
      // window is held in the required number of copies.
      const canRun = (low: number): boolean => {
        for (let r = low; r < low + span; r++) {
          if (r > 14) return false; // 2 and the jokers are not run material
          if ((byRank.get(r)?.length ?? 0) < copies) return false;
        }
        return true;
      };
      const starts: number[] = [];
      for (let low = prevLow + 1; low + span - 1 <= 14; low++) if (canRun(low)) starts.push(low);
      if (starts.length === 0) continue;
      answered++;

      const moves = findAllLegalMoves(hand, prev);
      const runs = moves.filter((m) => m.combo.type === prev.type);
      if (runs.length === 0) {
        throw new Error(
          `seed ${seed}: holds a higher ${prev.type} starting at rank ` +
            `${starts.join('/')} but was offered none — hand ${hand.join(' ')}`,
        );
      }
    }

    // Guards the test itself: if no seeded hand ever held a higher run, the
    // loop above would pass without asserting anything.
    expect(answered).toBeGreaterThan(10);
  });

  it('always finds a bomb or the rocket when it holds one', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const hand = deal(seed, 20);
      const byRank = ranksOf(hand);
      const hasBomb = [...byRank.entries()].some(([r, cs]) => r <= 15 && cs.length === 4);
      const hasRocket = Boolean(byRank.get(16) && byRank.get(17));
      if (!hasBomb && !hasRocket) continue;

      // Against a straight. A higher straight of the same length also answers
      // one, so the claim is not "every move is a bomb" — it is that the bomb
      // is among them. Holding four of a kind and being offered no bomb is a
      // bot that cannot spend its strongest card, which is the failure worth
      // pinning.
      const moves = findAllLegalMoves(hand, combo(['4c', '5c', '6c', '7c', '8c']));
      expect(
        moves.some((m) => m.combo.type === ComboType.Bomb || m.combo.type === ComboType.Rocket),
      ).toBe(true);
    }
  });
});

describe('DDZ AI — what it offers actually beats what it answers', () => {
  it.each(PREVIOUS)('every answer to a $label genuinely beats it', ({ cards }) => {
    const previous = combo(cards);
    for (let seed = 1; seed <= 60; seed++) {
      for (const move of findAllLegalMoves(deal(seed, 20), previous)) {
        // Not just "the validator allowed it" — the comparison itself must hold,
        // so a permissive validator cannot hide a generator that plays under.
        expect(beats(previous, move.combo)).toBe(true);
      }
    }
  });
});
