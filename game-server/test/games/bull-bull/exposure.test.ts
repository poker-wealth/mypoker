import {
  BullBullEngine,
  betExposure,
  firstBidderTieBreak,
} from '../../../src/games/bull-bull/index';

/**
 * NOBODY BETS MONEY THEY DO NOT HAVE.
 *
 * A bet's cost is stake × player multiplier × banker multiplier, so the number on the chip is not
 * the number at risk: ₦1,000 at 5x against a 5x bank settles ₦25,000. Checking the stake against
 * the balance is how a player holding ₦1,000 finished a round at −₦24,000 — the table still
 * balanced to zero, it just balanced through people who could not pay.
 *
 * Both sides are checked here, because the bank carries every player's win at once.
 */

const seats = (bankerBalance: number, playerBalance: number) => [
  { id: 'p0', name: 'Banker', balance: bankerBalance },
  { id: 'p1', name: 'Player 1', balance: playerBalance },
  { id: 'p2', name: 'Player 2', balance: playerBalance },
  { id: 'p3', name: 'Player 3', balance: playerBalance },
];

/** A table with p0 banking at the given multiplier, ready to take bets. */
function tableWithBanker(
  bankerMultiplier: number,
  bankerBalance = 100_000,
  playerBalance = 50_000,
  limits = {},
): BullBullEngine {
  const engine = new BullBullEngine('t', seats(bankerBalance, playerBalance), {
    limits: { maxBet: 50_000, ...limits },
    bankerTieBreak: firstBidderTieBreak,
  });
  engine.submitBankerBid('p0', bankerMultiplier);
  engine.selectBanker();
  return engine;
}

/** Play the round out from BETTING and hand back the final balances. */
function playOut(engine: BullBullEngine): Record<string, number> {
  let n = 0;
  engine.deal(() => ((n = (n + 37) % 101), n / 101));
  engine.setRevealProgress(5);
  engine.evaluate();
  engine.settle();
  return Object.fromEntries(engine.getRoomState().players.map((p) => [p.id, p.balance]));
}

describe('exposure — the number that actually matters', () => {
  it('is the stake times both multipliers, not the stake', () => {
    expect(betExposure(1_000, 5, 5)).toBe(25_000);
    expect(betExposure(1_000, 1, 1)).toBe(1_000);
  });

  it('refuses a bet the player cannot cover, even when the stake alone fits', () => {
    const engine = tableWithBanker(5, 100_000, 1_000);
    // The stake IS the whole balance, so the old face-value check waved this through.
    expect(() => engine.placeBet('p1', 1_000, 5)).toThrow(/cannot cover ₦25,000/);
    expect(engine.availableFor('p1')).toBe(1_000);
  });

  it('accepts the same stake once the multipliers bring it inside the balance', () => {
    const engine = tableWithBanker(1, 100_000, 1_000);
    engine.placeBet('p1', 1_000, 1); // 1,000 × 1 × 1
    expect(engine.availableFor('p1')).toBe(0);
  });

  it('refuses a bet the BANK cannot cover across the whole table', () => {
    const engine = tableWithBanker(1, 12_000);
    engine.placeBet('p1', 5_000, 1);
    engine.placeBet('p2', 5_000, 1); // bank now carries 10,000 of its 12,000
    expect(() => engine.placeBet('p3', 5_000, 1)).toThrow(/bank cannot cover/);
    expect(engine.bankerExposure()).toBe(10_000);
  });

  it('frees the old reservation when a player changes their bet', () => {
    const engine = tableWithBanker(1, 100_000, 10_000);
    engine.placeBet('p1', 8_000, 1);
    expect(engine.availableFor('p1')).toBe(2_000);
    engine.placeBet('p1', 1_000, 1); // replaces it, does not stack
    expect(engine.availableFor('p1')).toBe(9_000);
    expect(engine.bankerExposure()).toBe(1_000);
  });

  it('never settles anyone into a negative balance', () => {
    // The scenario that used to end at −₦24,000: thin player, thin bank, everything at 5x.
    const engine = tableWithBanker(5, 60_000, 1_000);
    for (const id of ['p1', 'p2', 'p3']) {
      expect(() => engine.placeBet(id, 1_000, 5)).toThrow();
      engine.placeBet(id, 100, 1); // what they can actually cover: 100 × 1 × 5 = 500
    }

    const balances = playOut(engine);
    for (const [id, balance] of Object.entries(balances)) {
      expect(balance).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(balance)).toBe(true);
      expect(id).toBeTruthy();
    }
  });

  it('conserves every naira across the round', () => {
    const engine = tableWithBanker(2, 80_000, 20_000);
    engine.placeBet('p1', 1_000, 2);
    engine.placeBet('p2', 2_000, 1);
    engine.placeBet('p3', 500, 5);

    const before = engine.getRoomState().players.reduce((t, p) => t + p.balance, 0);
    const balances = playOut(engine);
    const after = Object.values(balances).reduce((t, b) => t + b, 0);
    expect(after).toBe(before);
  });

  it('releases every reservation once the round settles', () => {
    const engine = tableWithBanker(2, 80_000, 20_000);
    engine.placeBet('p1', 1_000, 2);
    engine.placeBet('p2', 1_000, 2);
    playOut(engine);
    for (const p of engine.getRoomState().players) expect(p.reserved).toBe(0);
  });
});

describe('table limits', () => {
  it('enforces the minimum and maximum stake', () => {
    const engine = tableWithBanker(1, 100_000, 50_000, { minBet: 100, maxBet: 5_000 });
    expect(() => engine.placeBet('p1', 50, 1)).toThrow(/minimum bet is ₦100/);
    expect(() => engine.placeBet('p1', 5_001, 1)).toThrow(/maximum bet is ₦5,000/);
    engine.placeBet('p1', 5_000, 1);
  });

  it('rejects stakes that are not whole numbers, and unlisted multipliers', () => {
    const engine = tableWithBanker(1);
    expect(() => engine.placeBet('p1', 100.5, 1)).toThrow(/whole number/);
    expect(() => engine.placeBet('p1', 1_000, 3)).toThrow(/multiplier must be one of/);
  });

  it('takes its multiplier options from the room config', () => {
    const engine = new BullBullEngine('t', seats(100_000, 50_000), {
      limits: { bankerBidOptions: [1, 10], betMultiplierOptions: [1, 3] },
      bankerTieBreak: firstBidderTieBreak,
    });
    expect(() => engine.submitBankerBid('p0', 5)).toThrow(/banker bid must be one of/);
    engine.submitBankerBid('p0', 10);
    engine.selectBanker();
    expect(() => engine.placeBet('p1', 100, 2)).toThrow(/multiplier must be one of/);
    engine.placeBet('p1', 100, 3);
  });
});

describe('the engine owns the state', () => {
  it('hands out a copy, so a caller cannot rewrite a balance', () => {
    const engine = tableWithBanker(1);
    const state = engine.getRoomState();
    state.players[1]!.balance = 999_999_999;
    state.phase = 'SETTLEMENT';

    const fresh = engine.getRoomState();
    expect(fresh.players[1]!.balance).toBe(50_000);
    expect(fresh.phase).toBe('BETTING');
  });
});

describe('banker selection', () => {
  it('gives the bank to the highest bidder', () => {
    const engine = new BullBullEngine('t', seats(50_000, 50_000));
    engine.submitBankerBid('p0', 1);
    engine.submitBankerBid('p1', 5);
    engine.submitBankerBid('p2', 2);
    engine.submitBankerBid('p3', 1);
    engine.selectBanker();

    const state = engine.getRoomState();
    expect(state.bankerState).toEqual({ playerId: 'p1', multiplier: 5 });
    expect(state.players.filter((p) => p.isBanker).map((p) => p.id)).toEqual(['p1']);
  });

  it('breaks a tie with the rule the table was given', () => {
    const engine = new BullBullEngine('t', seats(50_000, 50_000), {
      bankerTieBreak: firstBidderTieBreak,
    });
    engine.submitBankerBid('p0', 5);
    engine.submitBankerBid('p1', 5);
    engine.selectBanker();
    expect(engine.getRoomState().bankerState?.playerId).toBe('p0');

    // The default draws among the tied bidders instead — same bids, other seat.
    const random = new BullBullEngine('t', seats(50_000, 50_000));
    random.submitBankerBid('p0', 5);
    random.submitBankerBid('p1', 5);
    random.selectBanker(() => 0.99);
    expect(random.getRoomState().bankerState?.playerId).toBe('p1');
  });

  it('treats no bid as a bid of 1', () => {
    const engine = new BullBullEngine('t', seats(50_000, 50_000), {
      bankerTieBreak: firstBidderTieBreak,
    });
    engine.submitBankerBid('p2', 2);
    engine.selectBanker();
    expect(engine.getRoomState().bankerState).toEqual({ playerId: 'p2', multiplier: 2 });
  });
});

describe('phase guards', () => {
  it('refuses actions that belong to another phase', () => {
    const engine = tableWithBanker(1);
    expect(() => engine.submitBankerBid('p1', 2)).toThrow(/cannot bid for the bank during BETTING/);
    expect(() => engine.settle()).toThrow(/cannot settle the round during BETTING/);

    engine.placeBet('p1', 1_000, 1);
    engine.deal(() => 0.5);
    expect(() => engine.placeBet('p2', 1_000, 1)).toThrow(/cannot place a bet during REVEAL/);
  });

  it('sits a player out rather than betting money they cannot cover', () => {
    // p3 cannot afford the table minimum, so the deal must not invent a bet for them.
    const engine = new BullBullEngine(
      't',
      [
        { id: 'p0', name: 'Banker', balance: 100_000 },
        { id: 'p1', name: 'Player 1', balance: 50_000 },
        { id: 'p2', name: 'Player 2', balance: 50_000 },
        { id: 'p3', name: 'Skint', balance: 10 },
      ],
      { bankerTieBreak: firstBidderTieBreak },
    );
    engine.submitBankerBid('p0', 1);
    engine.selectBanker();
    engine.placeBet('p1', 1_000, 1);
    engine.deal(() => 0.5);

    const state = engine.getRoomState();
    expect(state.bets['p3']).toBeUndefined();
    expect(state.bets['p2']).toBeDefined(); // p2 could cover the minimum, so they are dealt in

    engine.setRevealProgress(5);
    engine.evaluate();
    engine.settle();
    expect(engine.getRoomState().players.find((p) => p.id === 'p3')!.balance).toBe(10);
  });
});
