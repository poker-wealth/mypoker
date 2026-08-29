import { evaluateNiu, compareNiu, NiuStrength, describeNiu } from '../../../src/games/niu-niu/niu-niu-hand';
import { standardDeck } from '../../../src/fairness/shuffle';

/**
 * The Niu Niu evaluator, checked against EVERY hand in the deck.
 *
 * The rules brief for this game singles the evaluator out: "you cannot simply
 * take the first three cards that total 10/20/30. You need to examine the
 * possible 3-card combinations and select the arrangement that produces the
 * highest valid Niu result. That's the part I'd test heavily."
 *
 * So that is what these do — with an independent reference implementation
 * written from the rules text rather than from the code under test, and run
 * over all 2,598,960 five-card hands rather than a handful of examples. Two
 * separate implementations agreeing on every hand in the deck is a much
 * stronger statement than any set of chosen cases.
 */

/** Card points, straight from the brief: A = 1, 2–9 face value, 10/J/Q/K = 10. */
function pointOf(card: string): number {
  const r = card[0]!;
  if (r === 'A') return 1;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  return Number(r);
}

/** Every 3-card subset of five, by index. */
const TRIOS: [number, number, number][] = [];
for (let i = 0; i < 5; i++)
  for (let j = i + 1; j < 5; j++) for (let k = j + 1; k < 5; k++) TRIOS.push([i, j, k]);

/**
 * The brief's algorithm, implemented literally: try every trio, keep the best
 * Niu any of them yields. Niu Niu counts as 10 because it is the TOP of the
 * ordinary scale, not a zero — reading `% 10 === 0` as "worst" is the other
 * way this evaluator gets written wrong.
 */
function referenceBull(cards: readonly string[]): number | null {
  const pts = cards.map(pointOf);
  const total = pts.reduce((a, b) => a + b, 0);
  let best: number | null = null;
  for (const [i, j, k] of TRIOS) {
    const trio = pts[i]! + pts[j]! + pts[k]!;
    if (trio % 10 !== 0) continue;
    const pair = (total - trio) % 10;
    const niu = pair === 0 ? 10 : pair;
    if (best === null || niu > best) best = niu;
  }
  return best; // null === No Bull
}

describe('Niu Niu — the trio you pick cannot change the answer', () => {
  /**
   * The brief's central warning is, on inspection, unnecessary — and it is
   * worth knowing that rather than carrying a "pick the best arrangement"
   * search the game does not need.
   *
   * The five cards total T. A qualifying trio sums to S with S ≡ 0 (mod 10),
   * so the remaining pair sums to T − S ≡ T (mod 10). The trio drops out. Every
   * qualifying trio therefore yields the SAME Niu, and there is nothing to
   * choose between them.
   *
   * Proved rather than argued: over every multiset of five card-point values,
   * which is the whole space the arithmetic can see.
   *
   * This also settles a claim next door. `niu-niu-hand.test.ts` has a case
   * called "finds the best split of the five cards, not the first one that
   * works", whose comment says a worse partition "would score this far lower".
   * It cannot: 5-5-K-3-7 gives Niu Niu through {5,5,K} and through {K,3,7}
   * alike. That test passes, and should stay — but it is pinning a property
   * that holds for free, not one the evaluator has to work for.
   */
  it('every qualifying trio yields the same Niu, across all point combinations', () => {
    let multisets = 0;
    let withMultipleTrios = 0;

    for (let a = 1; a <= 10; a++)
      for (let b = a; b <= 10; b++)
        for (let c = b; c <= 10; c++)
          for (let d = c; d <= 10; d++)
            for (let e = d; e <= 10; e++) {
              multisets++;
              const pts = [a, b, c, d, e];
              const total = pts.reduce((x, y) => x + y, 0);
              const values = new Set<number>();
              for (const [i, j, k] of TRIOS) {
                const trio = pts[i]! + pts[j]! + pts[k]!;
                if (trio % 10 === 0) values.add((total - trio) % 10);
              }
              if (values.size > 1) {
                throw new Error(
                  `points ${pts.join(',')} yield different Niu depending on the trio: ` +
                    `${[...values].join('/')}`,
                );
              }
              if (values.size === 1) withMultipleTrios++;
            }

    expect(multisets).toBe(2002); // C(14,5) — every multiset of 5 values from 1..10
    // Guards the guard: if almost nothing had a bull, the loop proves nothing.
    expect(withMultipleTrios).toBeGreaterThan(1000);
  });
});

describe('Niu Niu — evaluator vs an independent reference, over the whole deck', () => {
  const deck = standardDeck();

  it('agrees with the reference on all 2,598,960 five-card hands', () => {
    let hands = 0;
    const seen = new Map<number, number>();

    for (let a = 0; a < 48; a++)
      for (let b = a + 1; b < 49; b++)
        for (let c = b + 1; c < 50; c++)
          for (let d = c + 1; d < 51; d++)
            for (let e = d + 1; e < 52; e++) {
              const cards = [deck[a]!, deck[b]!, deck[c]!, deck[d]!, deck[e]!];
              hands++;
              const rank = evaluateNiu(cards);
              seen.set(rank.strength, (seen.get(rank.strength) ?? 0) + 1);

              // Special hands outrank the ordinary scale and are checked
              // separately below; here we pin the Niu arithmetic itself.
              if (rank.strength > NiuStrength.NiuNiu) continue;

              const expected = referenceBull(cards);
              const actual = rank.strength === NiuStrength.NoBull ? null : rank.strength;
              if (actual !== expected) {
                throw new Error(
                  `${cards.join(' ')} — evaluator said ${describeNiu(rank)} ` +
                    `(${actual}), reference said ${expected}`,
                );
              }
            }

    expect(hands).toBe(2_598_960);
    // Every rung of the ladder is actually reachable. A ladder with an
    // unreachable rung is a scoring bug that no example-based test would show.
    for (let s = 0; s <= NiuStrength.FiveSmall; s++) {
      expect(seen.get(s) ?? 0).toBeGreaterThan(0);
    }
  }, 300_000);
});

describe('Niu Niu — the special hands', () => {
  it('Five Small: every card 4 or under and no more than 10 in total', () => {
    expect(evaluateNiu(['Ac', 'Ad', 'Ah', '2c', '3c']).strength).toBe(NiuStrength.FiveSmall);
    // 1+2+3+4+A = 11 — over the total, so it is not Five Small.
    expect(evaluateNiu(['Ac', '2c', '3c', '4c', 'Ad']).strength).not.toBe(NiuStrength.FiveSmall);
  });

  it('Five Flowers is J/Q/K only — a ten does not count as a flower', () => {
    expect(evaluateNiu(['Jc', 'Qd', 'Kh', 'Js', 'Qc']).strength).toBe(NiuStrength.FiveFlowers);
    expect(evaluateNiu(['Tc', 'Qd', 'Kh', 'Js', 'Qc']).strength).not.toBe(NiuStrength.FiveFlowers);
  });

  it('Bomb is four of a kind', () => {
    expect(evaluateNiu(['8c', '8d', '8h', '8s', 'Kc']).strength).toBe(NiuStrength.Bomb);
  });

  it('ranks the specials above Niu Niu, in the order this house has chosen', () => {
    // Five Flowers is also arithmetically Niu Niu (any three tens sum to 30,
    // the other two to 20). The special classification has to win, or the
    // strongest hands in the game would score as ordinary ones.
    const flowers = evaluateNiu(['Jc', 'Qd', 'Kh', 'Js', 'Qc']);
    expect(referenceBull(['Jc', 'Qd', 'Kh', 'Js', 'Qc'])).toBe(10);
    expect(flowers.strength).toBe(NiuStrength.FiveFlowers);

    const ladder = [
      NiuStrength.NoBull,
      9,
      NiuStrength.NiuNiu,
      NiuStrength.Bomb,
      NiuStrength.FiveFlowers,
      NiuStrength.FiveSmall,
    ];
    expect([...ladder].sort((x, y) => x - y)).toEqual(ladder);
  });
});

describe('Niu Niu — comparison', () => {
  it('never returns a dead heat between two hands from one deck', () => {
    // A tie would be settled by the `cmp > 0` in niu-niu-game, i.e. silently
    // for the banker. It cannot arise: strength ties break on the top card's
    // rank and then its suit, and two hands from one deck cannot hold the same
    // card. This pins that reasoning.
    const deck = standardDeck();
    for (let i = 0; i < deck.length - 9; i++) {
      const a = deck.slice(i, i + 5);
      const b = deck.slice(i + 5, i + 10);
      expect(compareNiu(evaluateNiu(a), evaluateNiu(b))).not.toBe(0);
    }
  });

  /**
   * OPEN QUESTION, pinned so it is a decision rather than an accident.
   *
   * The tie-break ranks the Ace HIGH — above the King. Nothing in the Niu Niu
   * code chose that: `topCard` reads ranks through `parseCard` from the Texas
   * evaluator, where A = 14 because that is poker. The suit tie-break directly
   * below it has a comment explaining why it exists; the Ace ordering has
   * none, which is the tell that it was inherited rather than picked.
   *
   * The usual Niu Niu convention runs the other way — K > Q > J > 10 > … > 2 >
   * A — because the Ace is worth ONE point in this game. The rules brief says
   * only that tie-break rules "can vary by implementation", so this is a house
   * choice and not a rules violation. It does move money: two equal Niu hands
   * are settled by it, and a hand holding any Ace currently wins every such
   * tie.
   *
   * If the house wants the conventional order, `topCard` needs its own rank
   * map (A = 1) rather than poker's.
   */
  it('CURRENT CHOICE: the Ace ranks above the King in a tie-break', () => {
    const ace = evaluateNiu(['As', '9c', '8d', '3h', '2c']); // Niu 3, top card A
    const king = evaluateNiu(['Kc', '7h', '3d', '8s', '5c']); // Niu 3, top card K
    expect(ace.strength).toBe(3);
    expect(king.strength).toBe(3);
    expect(compareNiu(ace, king)).toBeGreaterThan(0);
  });

  it('breaks an equal-strength tie by top card, then by suit', () => {
    const lowSuit = evaluateNiu(['9c', 'Ac', '2d', '3d', '5h']); // top card 9c
    const highSuit = evaluateNiu(['9s', 'Ad', '2h', '3h', '5s']); // same shape, 9s
    expect(lowSuit.strength).toBe(highSuit.strength);
    expect(compareNiu(highSuit, lowSuit)).toBeGreaterThan(0);
  });
});
