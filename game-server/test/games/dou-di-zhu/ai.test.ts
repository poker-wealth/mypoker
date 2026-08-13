import { chooseBestMove, evaluateBidding, findAllLegalMoves } from '../../../src/games/dou-di-zhu/ai';
import { validateMove } from '../../../src/games/dou-di-zhu/validator';

describe('Dou Dizhu AI & Validator System', () => {
  it('validates card ownership and legal combinations', () => {
    const hand = ['3S', '3H', '4S', '5S', '6S', '7S', '8S'];
    const res = validateMove(['3S', '3H'], null, hand);
    expect(res.valid).toBe(true);
    expect(res.combination?.type).toBe('pair');

    const invalidRes = validateMove(['9S'], null, hand);
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.reason).toContain('not in player hand');
  });

  it('evaluates bidding correctly', () => {
    const strongHand = ['2s', '2h', '2d', 'js', 'jb', 'As', 'Ks'];
    const bid = evaluateBidding(strongHand, 'HARD');
    expect(bid).toBeGreaterThanOrEqual(2);
  });

  it('finds legal moves and chooses best move for Easy, Medium, and Hard AI', () => {
    const hand = ['3S', '3H', '4S', '4H', '5S', '5H'];
    const moves = findAllLegalMoves(hand, null);
    expect(moves.length).toBeGreaterThan(0);

    const easyMove = chooseBestMove(hand, null, 'EASY');
    expect(easyMove).toBeDefined();

    const hardMove = chooseBestMove(hand, null, 'HARD');
    expect(hardMove).toBeDefined();
  });
});
