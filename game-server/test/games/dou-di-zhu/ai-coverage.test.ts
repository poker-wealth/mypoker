import {
  analyseHand,
  chooseBestMove,
  evaluateHand,
  findAllLegalMoves,
} from '../../../src/games/dou-di-zhu/ai';
import { ComboType, classifyPlay } from '../../../src/games/dou-di-zhu/combos';
import { cardRank } from '../../../src/games/dou-di-zhu/ddz-deck';

/**
 * A SHAPE THE AI CANNOT GENERATE IS A SHAPE IT CANNOT ANSWER.
 *
 * The move generator used to stop at singles, pairs, triples and straights, so an AI holding
 * 666 777 met an airplane of 444 555 by passing — and then dumped those same cards away one at a
 * time. Nothing failed; it just played badly, everywhere, forever. These tests are the floor:
 * every legal shape must be findable, and answerable.
 */

const ranksOf = (cards: string[]) => cards.map(cardRank);

describe('the AI can find every shape it is allowed to play', () => {
  const hand = [
    '3c', '4c', '5c', '6c', '7c', // a straight
    '8c', '8d', '8h', '9c', '9d', '9h', // an airplane core
    'Jc', 'Jd', 'Qc', 'Qd', 'Kc', 'Kd', // three consecutive pairs
  ];
  const shapes = new Set(findAllLegalMoves(hand, null).map((m) => m.combo.type));

  it.each([
    ComboType.Single,
    ComboType.Pair,
    ComboType.Triple,
    ComboType.Straight,
    ComboType.PairStraight,
    ComboType.Airplane,
    ComboType.AirplaneSingles,
    ComboType.AirplanePairs,
  ])('finds %s', (shape) => {
    expect(shapes).toContain(shape);
  });

  it('finds bombs and the rocket when it holds them', () => {
    const armed = ['7c', '7d', '7h', '7s', 'js', 'jb'];
    const types = new Set(findAllLegalMoves(armed, null).map((m) => m.combo.type));
    expect(types).toContain(ComboType.Bomb);
    expect(types).toContain(ComboType.Rocket);
  });

  it('only offers moves the player actually holds', () => {
    for (const move of findAllLegalMoves(hand, null)) {
      const pool = [...hand];
      for (const card of move.cards) {
        const at = pool.indexOf(card);
        expect(at).toBeGreaterThanOrEqual(0); // never invents a card
        pool.splice(at, 1);
      }
    }
  });
});

describe('the AI answers what is put in front of it', () => {
  const context = {
    isLandlord: false,
    landlordPlayerId: 'x',
    myPlayerId: 'me',
    opponentCardCounts: {},
  };

  it('beats an airplane with a bigger airplane instead of passing', () => {
    const airplane = classifyPlay(ranksOf(['4c', '4d', '4h', '5c', '5d', '5h']))!;
    const move = chooseBestMove(['6c', '6d', '6h', '7c', '7d', '7h', '2c'], airplane, 'HARD', context);
    expect(move).not.toBeNull();
    expect(classifyPlay(ranksOf(move!))!.type).toBe(ComboType.Airplane);
  });

  it('beats consecutive pairs with higher consecutive pairs', () => {
    const pairs = classifyPlay(ranksOf(['5c', '5d', '6c', '6d', '7c', '7d']))!;
    const move = chooseBestMove(
      ['8c', '8d', '9c', '9d', 'Tc', 'Td', '3c'],
      pairs,
      'HARD',
      context,
    );
    expect(move).not.toBeNull();
    expect(classifyPlay(ranksOf(move!))!.type).toBe(ComboType.PairStraight);
  });

  it('passes when it genuinely cannot answer', () => {
    const rocket = classifyPlay(ranksOf(['js', 'jb']))!;
    expect(chooseBestMove(['3c', '4d', '5h'], rocket, 'HARD', context)).toBeNull();
  });

  it('never answers with cards it does not hold, at any difficulty', () => {
    const hand = ['3c', '3d', '9c', '9d', 'Kc', 'Kd', '2c', 'js'];
    const pair = classifyPlay(ranksOf(['5c', '5d']))!;
    for (const level of ['EASY', 'MEDIUM', 'HARD'] as const) {
      const move = chooseBestMove(hand, pair, level, context);
      if (!move) continue;
      const pool = [...hand];
      for (const card of move) {
        const at = pool.indexOf(card);
        expect(at).toBeGreaterThanOrEqual(0);
        pool.splice(at, 1);
      }
      expect(classifyPlay(ranksOf(move))).not.toBeNull();
    }
  });
});

describe('hand evaluation', () => {
  it('scores a hand that empties in fewer plays above one that does not', () => {
    const tidy = ['3c', '3d', '3h', '4c', '4d', '4h']; // one airplane
    const scattered = ['3c', '5d', '7h', '9c', 'Jd', 'Kh']; // six singles
    expect(analyseHand(tidy).combinationsNeeded).toBeLessThan(
      analyseHand(scattered).combinationsNeeded,
    );
    expect(evaluateHand(tidy)).toBeGreaterThan(evaluateHand(scattered));
  });

  it('counts the muscle in a hand', () => {
    const strong = analyseHand(['9c', '9d', '9h', '9s', '2c', '2d', 'js', 'jb']);
    expect(strong.bombs).toBe(1);
    expect(strong.hasRocket).toBe(true);
    expect(strong.twos).toBe(2);
    expect(evaluateHand(['9c', '9d', '9h', '9s', 'js', 'jb'])).toBeGreaterThan(
      evaluateHand(['3c', '4d', '5h', '6c', '8d', 'Ts']),
    );
  });

  it('is a plain number, as the brief asks', () => {
    expect(typeof evaluateHand(['3c', '4d'])).toBe('number');
  });
});
