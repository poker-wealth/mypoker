import { BullBullEngine } from '../../../src/games/bull-bull/engine';

describe('BullBullEngine — 4-Player State Machine & Lifecycle', () => {
  it('runs a complete deterministic 4-player round and verifies zero-sum balances', () => {
    const engine = new BullBullEngine('room-test', [
      { id: 'p0', name: 'Alice', balance: 50_000 },
      { id: 'p1', name: 'Bob', balance: 50_000 },
      { id: 'p2', name: 'Charlie', balance: 50_000 },
      { id: 'p3', name: 'David', balance: 50_000 },
    ]);

    let state = engine.getRoomState();
    expect(state.phase).toBe('BANKER_SELECTION');

    // 1. Banker Bidding
    engine.submitBankerBid('p0', 1);
    engine.submitBankerBid('p1', 5); // Bob bids highest 5x
    engine.submitBankerBid('p2', 2);
    engine.submitBankerBid('p3', 1);

    engine.selectBanker();

    state = engine.getRoomState();
    expect(state.phase).toBe('BETTING');
    expect(state.bankerState?.playerId).toBe('p1');
    expect(state.bankerState?.multiplier).toBe(5);

    // 2. Player Betting (non-banker players p0, p2, p3).
    // Stakes the bank can actually cover: at a 5x bank these commit 10,000 + 2,500 + 10,000 =
    // ₦22,500 of Bob's ₦50,000. (₦2,000 at 5x would be ₦50,000 from one player alone.)
    engine.placeBet('p0', 1000, 2);
    engine.placeBet('p2', 500, 1);
    engine.placeBet('p3', 2000, 1);

    // 3. Dealing with fixed random generator
    let seedCounter = 0;
    const pseudoRandom = () => {
      seedCounter = (seedCounter + 1) % 100;
      return (seedCounter * 17) % 100 / 100;
    };

    engine.deal(pseudoRandom);
    state = engine.getRoomState();
    expect(state.phase).toBe('REVEAL');

    // 4. Reveal & Evaluate
    engine.setRevealProgress(5);
    expect(engine.getRoomState().phase).toBe('EVALUATION');

    engine.evaluate();
    expect(engine.getRoomState().phase).toBe('RESULTS');

    // 5. Settlement
    const initialTotalChips = state.players.reduce((sum, p) => sum + p.balance, 0);

    engine.settle();
    state = engine.getRoomState();
    expect(state.phase).toBe('SETTLEMENT');

    const finalTotalChips = state.players.reduce((sum, p) => sum + p.balance, 0);

    // Zero-sum balance conservation invariant across all 4 players
    expect(finalTotalChips).toBe(initialTotalChips);

    // 6. Reset for Next Round
    engine.nextRound();
    expect(engine.getRoomState().phase).toBe('BANKER_SELECTION');
  });

  it('enforces validation guards (rejecting bets from Banker, invalid phases)', () => {
    const engine = new BullBullEngine('room-val', [
      { id: 'p0', name: 'Alice', balance: 50_000 },
      { id: 'p1', name: 'Bob', balance: 50_000 },
      { id: 'p2', name: 'Charlie', balance: 50_000 },
      { id: 'p3', name: 'David', balance: 50_000 },
    ]);

    engine.submitBankerBid('p0', 5);
    engine.selectBanker(); // p0 becomes banker

    // Banker attempting to bet must throw Error
    expect(() => engine.placeBet('p0', 1000, 1)).toThrow(/banker does not bet/i);

    // Bet over balance must throw Error
    expect(() => engine.placeBet('p1', 100_000, 1)).toThrow(/maximum bet/i);
  });
});
