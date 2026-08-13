import { createDeck } from '../../../src/games/bull-bull/card';
import { evaluateHand } from '../../../src/games/bull-bull/evaluator';
import {
  calculateSettlement,
  verifyAccountingInvariant,
  Settlement,
} from '../../../src/games/bull-bull/settlement';

function makeCard(rank: string, suit: string) {
  const deck = createDeck();
  return deck.find((c) => c.rank === rank && c.suit === suit)!;
}

describe('Bull-Bull Settlement & Accounting Invariant', () => {
  it('calculates win payout using Bet * PlayerMultiplier * BankerMultiplier', () => {
    const playerHand = evaluateHand([
      makeCard('10', 'SPADES'),
      makeCard('K', 'HEARTS'),
      makeCard('Q', 'DIAMONDS'),
      makeCard('5', 'CLUBS'),
      makeCard('5', 'HEARTS'),
    ]); // Bull Bull

    const bankerHand = evaluateHand([
      makeCard('2', 'CLUBS'),
      makeCard('3', 'DIAMONDS'),
      makeCard('4', 'HEARTS'),
      makeCard('7', 'SPADES'),
      makeCard('8', 'CLUBS'),
    ]); // No Bull

    const bet = { playerId: 'p1', amount: 1000, multiplier: 2 };
    const bankerMultiplier = 5;

    const settlement = calculateSettlement(
      'p1',
      playerHand,
      bankerHand,
      bet,
      bankerMultiplier,
    );

    expect(settlement.result).toBe('WIN');
    expect(settlement.multiplier).toBe(10); // 2 * 5
    expect(settlement.payout).toBe(10000); // 1000 * 10
    expect(settlement.netChange).toBe(10000);
  });

  it('calculates loss payout correctly', () => {
    const playerHand = evaluateHand([
      makeCard('2', 'CLUBS'),
      makeCard('3', 'DIAMONDS'),
      makeCard('4', 'HEARTS'),
      makeCard('7', 'SPADES'),
      makeCard('8', 'CLUBS'),
    ]); // No Bull

    const bankerHand = evaluateHand([
      makeCard('10', 'SPADES'),
      makeCard('K', 'HEARTS'),
      makeCard('Q', 'DIAMONDS'),
      makeCard('5', 'CLUBS'),
      makeCard('5', 'HEARTS'),
    ]); // Bull Bull

    const bet = { playerId: 'p1', amount: 500, multiplier: 1 };
    const bankerMultiplier = 2;

    const settlement = calculateSettlement(
      'p1',
      playerHand,
      bankerHand,
      bet,
      bankerMultiplier,
    );

    expect(settlement.result).toBe('LOSS');
    expect(settlement.multiplier).toBe(2); // 1 * 2
    expect(settlement.payout).toBe(-1000);
    expect(settlement.netChange).toBe(-1000);
  });

  it('verifies that total player net changes + banker net change === 0', () => {
    const settlements: Settlement[] = [
      { playerId: 'p1', result: 'WIN', stake: 1000, multiplier: 10, payout: 10000, netChange: 10000 },
      { playerId: 'p2', result: 'LOSS', stake: 2000, multiplier: 5, payout: -10000, netChange: -10000 },
      { playerId: 'p3', result: 'WIN', stake: 500, multiplier: 2, payout: 1000, netChange: 1000 },
    ];

    const bankerNetChange = -(10000 - 10000 + 1000); // -1000

    expect(verifyAccountingInvariant(settlements, bankerNetChange)).toBe(true);
  });
});
