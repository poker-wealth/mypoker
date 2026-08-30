import {
  evaluateBest,
  evaluateOmaha,
  evaluateFive,
  compareHands,
  HandCategory,
  SHORT_DECK_RULES,
  STANDARD_RULES,
} from '../../../src/games/texas/hand-evaluator';
import { shortDeck, TEXAS, SHORT_DECK, OMAHA } from '../../../src/games/texas/variants';
import { TexasHand } from '../../../src/games/texas/texas-hand';

describe('Short Deck — the deck', () => {
  it('strips the 2s–5s, leaving 36 distinct cards', () => {
    const d = shortDeck();
    expect(d).toHaveLength(36);
    expect(new Set(d).size).toBe(36);
    expect(d.some((c) => ['2', '3', '4', '5'].includes(c[0]!))).toBe(false);
    expect(d.filter((c) => c[0] === 'A')).toHaveLength(4);
  });
});

describe('Short Deck — flush beats a full house', () => {
  const flush = ['Ah', 'Jh', '9h', '7h', '6h'];
  const boat = ['Kc', 'Kd', 'Ks', '7c', '7d'];

  it('the flush wins under short-deck rules', () => {
    const f = evaluateFive(flush, SHORT_DECK_RULES);
    const b = evaluateFive(boat, SHORT_DECK_RULES);
    expect(f.category).toBe(HandCategory.Flush);
    expect(b.category).toBe(HandCategory.FullHouse);
    expect(compareHands(f, b)).toBeGreaterThan(0); // flush > full house
  });

  it('but the full house still wins under standard rules — the rules, not the cards, changed', () => {
    const f = evaluateFive(flush, STANDARD_RULES);
    const b = evaluateFive(boat, STANDARD_RULES);
    expect(compareHands(b, f)).toBeGreaterThan(0); // full house > flush
  });
});

describe('Short Deck — the ace plays low below the six', () => {
  it('A-6-7-8-9 is a nine-high straight', () => {
    const r = evaluateFive(['Ac', '6d', '7h', '8s', '9c'], SHORT_DECK_RULES);
    expect(r.category).toBe(HandCategory.Straight);
    expect(r.tiebreak[0]).toBe(9);
  });

  it('and it loses to a ten-high straight', () => {
    const low = evaluateFive(['Ac', '6d', '7h', '8s', '9c'], SHORT_DECK_RULES);
    const high = evaluateFive(['Td', '9h', '8c', '7s', '6h'], SHORT_DECK_RULES);
    expect(compareHands(high, low)).toBeGreaterThan(0);
  });

  it('A-6-7-8-9 in one suit is a straight flush', () => {
    const r = evaluateFive(['Ah', '6h', '7h', '8h', '9h'], SHORT_DECK_RULES);
    expect(r.category).toBe(HandCategory.StraightFlush);
  });

  it('the standard A-2-3-4-5 wheel is unaffected', () => {
    const r = evaluateBest(['Ac', '2d', '3h', '4s', '5c'], STANDARD_RULES);
    expect(r.category).toBe(HandCategory.Straight);
    expect(r.tiebreak[0]).toBe(5);
  });
});

/**
 * The rest of the Short Deck ordering — the part that is a CHOICE.
 *
 * Flush-over-boat is the famous change and is pinned above. These are the ranks
 * around it, and they matter because Short Deck has no single ruleset: some
 * houses also lift trips above a straight. This project follows Triton, where
 * a straight still beats trips, and nothing failed if someone changed that —
 * the decision lived only in a comment.
 *
 * Full ordering under these rules, strongest first:
 *   straight flush · quads · FLUSH · full house · straight · trips · two pair
 */
describe('Short Deck — the rest of the ordering', () => {
  const better = (a: string[], b: string[]): number =>
    compareHands(evaluateFive(a, SHORT_DECK_RULES), evaluateFive(b, SHORT_DECK_RULES));

  it('a straight still beats three of a kind (Triton, not the house variant)', () => {
    const straight = ['6c', '7d', '8s', '9h', 'Tc'];
    const trips = ['Kc', 'Kd', 'Ks', '8h', '7c'];
    expect(evaluateFive(straight, SHORT_DECK_RULES).category).toBe(HandCategory.Straight);
    expect(evaluateFive(trips, SHORT_DECK_RULES).category).toBe(HandCategory.ThreeOfAKind);
    expect(better(straight, trips)).toBeGreaterThan(0);
  });

  it('a full house still beats a straight — only the flush moved', () => {
    expect(better(['7c', '7d', '7s', '8c', '8d'], ['6c', '7h', '8h', '9h', 'Tc'])).toBeGreaterThan(0);
  });

  it('quads still beat the flush that was promoted above the full house', () => {
    expect(better(['9c', '9d', '9s', '9h', 'Kc'], ['6h', '9h', 'Th', 'Jh', 'Kh'])).toBeGreaterThan(0);
  });

  it('T-J-Q-K-A is an ace-HIGH straight, and beats a king-high one', () => {
    // The ace is low only in A-6-7-8-9. At the top of the deck it is high, and
    // an evaluator that made the ace low everywhere would rank this wrong.
    const broadway = evaluateFive(['Tc', 'Jd', 'Qs', 'Kh', 'Ah'], SHORT_DECK_RULES);
    expect(broadway.category).toBe(HandCategory.Straight);
    expect(broadway.tiebreak[0]).toBe(14);
    expect(better(['Tc', 'Jd', 'Qs', 'Kh', 'Ah'], ['9c', 'Td', 'Js', 'Qh', 'Kc'])).toBeGreaterThan(0);
  });

  it('compares two full houses on the TRIPS first, not the pair', () => {
    // Nines full of sixes beats eights full of ACES. The pair is the tiebreak,
    // never the headline — getting this backwards pays the wrong player.
    expect(better(['9c', '9d', '9s', '6c', '6d'], ['8c', '8d', '8s', 'Ac', 'Ad'])).toBeGreaterThan(0);
  });

  it('takes the best FIVE of seven rather than smearing all seven together', () => {
    // A straight flush sitting alongside a pair of aces: the pair must not
    // contribute, and the result must be a single straight-flush tiebreak.
    const best = evaluateBest(['6h', '7h', '8h', '9h', 'Th', 'Ac', 'Ad'], SHORT_DECK_RULES);
    expect(best.category).toBe(HandCategory.StraightFlush);
    expect(best.tiebreak).toEqual([10]);
  });
});

describe('Omaha — exactly two from hand, exactly three from the board', () => {
  it('four hearts in hand + one on the board is NOT a flush', () => {
    // The classic misread: you may only ever play two of your own cards.
    const hole = ['Ah', 'Kh', 'Qh', 'Jh'];
    const board = ['2h', '7c', '9d', '4s', '3c'];
    const r = evaluateOmaha(hole, board);
    expect(r.category).not.toBe(HandCategory.Flush);
  });

  it('two hearts in hand + three on the board IS a flush', () => {
    const hole = ['Ah', 'Kh', '2c', '3d'];
    const board = ['5h', '9h', 'Jh', '4s', '7c'];
    const r = evaluateOmaha(hole, board);
    expect(r.category).toBe(HandCategory.Flush);
  });

  it('cannot play just one hole card, even when the board makes a straight', () => {
    // Board is already a 9-high straight; a lone king would make a K-high straight in Hold'em,
    // but Omaha forces two hole cards, so the best here uses 2 hole + 3 board.
    const hole = ['Kc', '2d', '3h', '4s'];
    const board = ['5c', '6d', '7h', '8s', '9c'];
    const holdem = evaluateBest([...hole.slice(0, 1), ...board]); // what Hold'em would give
    const omaha = evaluateOmaha(hole, board);
    expect(holdem.category).toBe(HandCategory.Straight);
    expect(omaha.tiebreak[0]).not.toBe(13); // never a king-high straight
  });

  it('finds a set + board pair as a full house using exactly two hole cards', () => {
    const hole = ['Qc', 'Qd', '2h', '3s'];
    const board = ['Qh', '7c', '7d', '4s', '9c'];
    const r = evaluateOmaha(hole, board); // QQ from hand + Q77 from board
    expect(r.category).toBe(HandCategory.FullHouse);
    expect(r.tiebreak).toEqual([12, 7]);
  });

  it('rejects a wrong number of cards', () => {
    expect(() => evaluateOmaha(['Ah', 'Kh', 'Qh'], ['2h', '7c', '9d', '4s', '3c'])).toThrow(/4 hole/);
    expect(() => evaluateOmaha(['Ah', 'Kh', 'Qh', 'Jh'], ['2h', '7c'])).toThrow(/5 board/);
  });
});

describe('variants at the table', () => {
  const players = [
    { id: 'p1', stack: 1000 },
    { id: 'p2', stack: 1000 },
    { id: 'p3', stack: 1000 },
  ];
  const cfg = { smallBlind: 10, bigBlind: 20, seed: 'variant-seed' };

  it('Texas deals 2 hole cards from the full deck', () => {
    const h = new TexasHand(players, { ...cfg, variant: TEXAS });
    expect(h.holeCardsFor('p1')).toHaveLength(2);
  });

  it('Omaha deals 4 hole cards, all distinct across the table', () => {
    const h = new TexasHand(players, { ...cfg, variant: OMAHA });
    const all: string[] = [];
    for (const p of players) {
      expect(h.holeCardsFor(p.id)).toHaveLength(4);
      all.push(...h.holeCardsFor(p.id)!);
    }
    expect(new Set(all).size).toBe(12); // no card dealt twice
  });

  it('Short Deck deals only from the 36-card deck', () => {
    const h = new TexasHand(players, { ...cfg, variant: SHORT_DECK });
    const dealt = players.flatMap((p) => [...h.holeCardsFor(p.id)!]);
    expect(dealt.every((c) => !['2', '3', '4', '5'].includes(c[0]!))).toBe(true);
  });

  it('plays a full hand to showdown and pays out, in every variant', () => {
    for (const v of [TEXAS, SHORT_DECK, OMAHA]) {
      const h = new TexasHand(players, { ...cfg, variant: v });
      // Everyone calls to showdown.
      while (!h.isComplete && h.toAct) {
        const actor = h.toAct;
        const legal = h.legalActions();
        h.act(actor, legal.canCheck ? { type: 'check' } : { type: 'call' });
      }
      const result = h.getResult()!;
      expect(result).not.toBeNull();
      const paid = [...result.payouts.values()].reduce((a, b) => a + b, 0);
      expect(paid).toBe(h.pot); // every chip in the pot goes home to someone
      expect(result.community).toHaveLength(5);
    }
  });
});
