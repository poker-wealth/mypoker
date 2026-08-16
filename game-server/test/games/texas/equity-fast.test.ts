import { standardDeck } from '../../../src/fairness/shuffle';
import { evaluateBest, compareHands, STANDARD_RULES } from '../../../src/games/texas/hand-evaluator';
import { bestRankStandard, scoreStandard } from '../../../src/games/texas/equity-fast';

/**
 * The fast equity evaluator must be BYTE-IDENTICAL to the trusted evaluateBest, or it silently
 * mis-prices insurance. This proves equivalence across a large random sample and every awkward edge
 * case, so bestRankStandard can safely replace evaluateBest inside computeEquity.
 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Draw n distinct cards from the deck using a seeded shuffle (partial Fisher–Yates). */
function draw(rng: () => number, n: number): string[] {
  const d = [...standardDeck()];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (d.length - i));
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d.slice(0, n);
}

/** The two fields compareHands actually reads. */
function comparable(cards: string[]): { strength: number; tiebreak: number[] } {
  const r = bestRankStandard(cards);
  return { strength: r.strength ?? r.category, tiebreak: r.tiebreak };
}
function comparableSlow(cards: string[]): { strength: number; tiebreak: number[] } {
  const r = evaluateBest(cards, STANDARD_RULES);
  return { strength: r.strength ?? r.category, tiebreak: r.tiebreak };
}

describe('bestRankStandard ≡ evaluateBest (standard rules)', () => {
  it('matches strength + tiebreak on 25,000 random 7-card hands', () => {
    const rng = lcg(0x5eed);
    let mismatches = 0;
    let firstBad: string[] | null = null;
    for (let i = 0; i < 25_000; i++) {
      const hand = draw(rng, 7);
      const a = comparable(hand);
      const b = comparableSlow(hand);
      if (a.strength !== b.strength || JSON.stringify(a.tiebreak) !== JSON.stringify(b.tiebreak)) {
        mismatches++;
        if (!firstBad) firstBad = hand;
      }
    }
    expect({ mismatches, firstBad }).toEqual({ mismatches: 0, firstBad: null });
  });

  it('agrees on the WINNER for 25,000 random head-to-head 7-card showdowns', () => {
    const rng = lcg(0xbeef);
    let bestDisagree = 0;
    let scoreDisagree = 0;
    for (let i = 0; i < 25_000; i++) {
      // Two 7-card hands sharing a 5-card board — the exact shape the equity loop compares.
      const cards = draw(rng, 9);
      const board = cards.slice(0, 5);
      const a = [cards[5]!, cards[6]!, ...board];
      const b = [cards[7]!, cards[8]!, ...board];
      const truth = Math.sign(compareHands(evaluateBest(a, STANDARD_RULES), evaluateBest(b, STANDARD_RULES)));
      if (Math.sign(compareHands(bestRankStandard(a), bestRankStandard(b))) !== truth) bestDisagree++;
      // scoreStandard is what computeEquity ACTUALLY compares — its integer order must match too.
      if (Math.sign(scoreStandard(a) - scoreStandard(b)) !== truth) scoreDisagree++;
    }
    expect({ bestDisagree, scoreDisagree }).toEqual({ bestDisagree: 0, scoreDisagree: 0 });
  });

  it.each([
    ['wheel straight', ['Ah', '2d', '3c', '4s', '5h', 'Kd', 'Qc']],
    ['wheel straight flush', ['Ah', '2h', '3h', '4h', '5h', 'Kd', 'Qc']],
    ['broadway straight', ['Th', 'Jd', 'Qc', 'Ks', 'Ah', '2d', '3c']],
    ['royal flush', ['Th', 'Jh', 'Qh', 'Kh', 'Ah', '2d', '3c']],
    ['two trips → full house', ['7h', '7d', '7c', '9s', '9h', '9d', '2c']],
    ['three pairs → two pair + kicker', ['Ah', 'Ad', 'Kh', 'Kd', 'Qh', 'Qd', '2c']],
    ['quads + trips → quads + kicker', ['8h', '8d', '8c', '8s', 'Kh', 'Kd', 'Kc']],
    ['six-card flush → top five', ['2h', '5h', '7h', '9h', 'Jh', 'Kh', 'Ad']],
    ['full house over flush', ['Ah', 'Ad', 'Ac', 'Kh', 'Kd', '5h', '2h']],
    ['pair with three kickers', ['9h', '9d', 'Ac', 'Ks', 'Qh', '4d', '2c']],
    ['straight over trips', ['5h', '6d', '7c', '8s', '9h', '9d', '9c']],
  ])('edge case: %s', (_label, hand) => {
    expect(comparable(hand)).toEqual(comparableSlow(hand));
  });
});
