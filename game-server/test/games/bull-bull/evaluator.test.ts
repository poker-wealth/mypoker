import { Card, createDeck } from '../../../src/games/bull-bull/card';
import {
  evaluateHand,
  compareHands,
  getHighestCard,
} from '../../../src/games/bull-bull/evaluator';

function makeCard(rank: Card['rank'], suit: Card['suit']): Card {
  const deck = createDeck();
  const card = deck.find((c) => c.rank === rank && c.suit === suit);
  if (!card) throw new Error(`Card not found: ${rank} ${suit}`);
  return card;
}

describe('Bull-Bull 5-Card Evaluator', () => {
  it('detects NO_BULL when no 3 cards sum to a multiple of 10', () => {
    const hand = [
      makeCard('2', 'CLUBS'),
      makeCard('3', 'DIAMONDS'),
      makeCard('4', 'HEARTS'),
      makeCard('7', 'SPADES'),
      makeCard('8', 'CLUBS'),
    ];
    const evalResult = evaluateHand(hand);
    expect(evalResult.type).toBe('NO_BULL');
    expect(evalResult.bullValue).toBe(0);
  });

  it('detects BULL_1 when valid 3-card trio leaves remainder 1', () => {
    const hand = [
      makeCard('10', 'SPADES'),
      makeCard('J', 'HEARTS'),
      makeCard('Q', 'DIAMONDS'),
      makeCard('A', 'CLUBS'),
      makeCard('10', 'CLUBS'),
    ];
    const evalResult = evaluateHand(hand);
    expect(evalResult.type).toBe('BULL_1');
    expect(evalResult.bullValue).toBe(1);
  });

  it('detects BULL_5 when valid 3-card trio leaves remainder 5', () => {
    const hand = [
      makeCard('3', 'SPADES'),
      makeCard('7', 'HEARTS'),
      makeCard('K', 'DIAMONDS'),
      makeCard('2', 'CLUBS'),
      makeCard('3', 'CLUBS'),
    ];
    const evalResult = evaluateHand(hand);
    expect(evalResult.type).toBe('BULL_5');
    expect(evalResult.bullValue).toBe(5);
  });

  it('detects BULL_9 when valid 3-card trio leaves remainder 9', () => {
    const hand = [
      makeCard('5', 'SPADES'),
      makeCard('5', 'HEARTS'),
      makeCard('10', 'DIAMONDS'),
      makeCard('4', 'CLUBS'),
      makeCard('5', 'CLUBS'),
    ];
    const evalResult = evaluateHand(hand);
    expect(evalResult.type).toBe('BULL_9');
    expect(evalResult.bullValue).toBe(9);
  });

  it('detects BULL_BULL when 3 cards sum to multiple of 10 and remaining 2 cards sum to multiple of 10', () => {
    const hand = [
      makeCard('10', 'SPADES'),
      makeCard('K', 'HEARTS'),
      makeCard('Q', 'DIAMONDS'),
      makeCard('5', 'CLUBS'),
      makeCard('5', 'HEARTS'),
    ];
    const evalResult = evaluateHand(hand);
    expect(evalResult.type).toBe('BULL_BULL');
    expect(evalResult.bullValue).toBe(10);
  });

  it('exhaustively checks all 10 partitions and selects the highest Bull hand', () => {
    // Hand contains choices:
    // Option 1: 10 + K + Q = 30 (trio) -> 3 + 4 = 7 (Bull 7)
    // Option 2: 10 + 3 + 7? No 7 here.
    // Option 3: K + Q + 10 = 30 -> 3 + 7 = 10 (Bull Bull) if 7 present
    const hand = [
      makeCard('10', 'SPADES'),
      makeCard('K', 'HEARTS'),
      makeCard('Q', 'DIAMONDS'),
      makeCard('3', 'CLUBS'),
      makeCard('7', 'CLUBS'),
    ];
    const evalResult = evaluateHand(hand);
    expect(evalResult.type).toBe('BULL_BULL');
    expect(evalResult.bullValue).toBe(10);
  });

  it('compares hands by Bull rank', () => {
    const playerHand = evaluateHand([
      makeCard('10', 'SPADES'),
      makeCard('K', 'HEARTS'),
      makeCard('Q', 'DIAMONDS'),
      makeCard('3', 'CLUBS'),
      makeCard('5', 'CLUBS'),
    ]); // Bull 8

    const bankerHand = evaluateHand([
      makeCard('10', 'SPADES'),
      makeCard('K', 'HEARTS'),
      makeCard('Q', 'DIAMONDS'),
      makeCard('2', 'CLUBS'),
      makeCard('4', 'CLUBS'),
    ]); // Bull 6

    expect(compareHands(playerHand, bankerHand)).toBe('PLAYER_WIN');
  });

  it('breaks ties by highest card rank (K > Q)', () => {
    const playerHand = evaluateHand([
      makeCard('10', 'SPADES'),
      makeCard('J', 'HEARTS'),
      makeCard('K', 'SPADES'), // K is highest
      makeCard('4', 'CLUBS'),
      makeCard('4', 'HEARTS'),
    ]); // Bull 8, High Card K♠

    const bankerHand = evaluateHand([
      makeCard('10', 'DIAMONDS'),
      makeCard('J', 'CLUBS'),
      makeCard('Q', 'SPADES'), // Q is highest
      makeCard('4', 'DIAMONDS'),
      makeCard('4', 'SPADES'),
    ]); // Bull 8, High Card Q♠

    expect(compareHands(playerHand, bankerHand)).toBe('PLAYER_WIN');
  });

  it('breaks rank ties by suit order (CLUBS < DIAMONDS < HEARTS < SPADES)', () => {
    const playerHand = evaluateHand([
      makeCard('10', 'SPADES'),
      makeCard('J', 'HEARTS'),
      makeCard('K', 'SPADES'), // K♠ highest
      makeCard('4', 'CLUBS'),
      makeCard('4', 'HEARTS'),
    ]);

    const bankerHand = evaluateHand([
      makeCard('10', 'DIAMONDS'),
      makeCard('J', 'CLUBS'),
      makeCard('K', 'HEARTS'), // K♥ highest
      makeCard('4', 'DIAMONDS'),
      makeCard('4', 'SPADES'),
    ]);

    expect(getHighestCard(playerHand.bestThreeCards.concat(playerHand.remainingTwoCards)).suit).toBe('SPADES');
    expect(compareHands(playerHand, bankerHand)).toBe('PLAYER_WIN');
  });
});
