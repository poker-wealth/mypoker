import {
  computeSettlement,
  computeRake,
  splitJackpot,
  toTableSettlementRequest,
  type TableSettlement,
} from '../../../src/games/texas/settlement';

const rake = { bps: 500, cap: 10000 }; // 5%, cap 10k

/** Σ(losers) must equal Σ(winners) + rake + jackpot — money is conserved. */
function expectConserved(s: TableSettlement): void {
  const lost = s.losers.reduce((a, l) => a + l.amount, 0);
  const won = s.winners.reduce((a, w) => a + w.amount, 0);
  expect(lost).toBe(won + s.rake + s.jackpotTotal);
  expect(s.jackpot.mini + s.jackpot.minor + s.jackpot.major + s.jackpot.grand).toBe(s.jackpotTotal);
}

describe('settlement — rake', () => {
  it('takes a capped basis-point cut of the pot', () => {
    expect(computeRake(3000, { bps: 500, cap: 10000 }, true)).toBe(150); // 5%
    expect(computeRake(1_000_000, { bps: 500, cap: 100 }, true)).toBe(100); // capped
  });

  it('honors no-flop-no-drop', () => {
    expect(computeRake(3000, { bps: 500, cap: 10000, noFlopNoDrop: true }, false)).toBe(0);
    expect(computeRake(3000, { bps: 500, cap: 10000, noFlopNoDrop: true }, true)).toBe(150);
  });
});

describe('settlement — jackpot split', () => {
  it('splits 20/30/25/25 with the remainder to Grand, summing exactly', () => {
    const s = splitJackpot(101);
    expect(s).toEqual({ mini: 20, minor: 30, major: 25, grand: 26 });
    expect(s.mini + s.minor + s.major + s.grand).toBe(101);
  });
});

describe('settlement — conservation', () => {
  it('single winner: rake + jackpot deducted from the winner, everything conserved', () => {
    const s = computeSettlement({
      payouts: new Map([['p0', 3000]]),
      contributions: new Map([['p0', 1000], ['p1', 1000], ['p2', 1000]]),
      rake,
      flopSeen: true,
    });
    // winner profit 2000 → jackpot floor(2000*0.5%) = 10; rake 5% of 3000 = 150.
    expect(s.rake).toBe(150);
    expect(s.jackpotTotal).toBe(10);
    expect(s.winners).toEqual([{ playerId: 'p0', amount: 3000 - 1000 - 150 - 10 }]); // 1840
    expect(s.losers).toEqual([
      { playerId: 'p1', amount: 1000 },
      { playerId: 'p2', amount: 1000 },
    ]);
    expectConserved(s);
  });

  it('split pot: house cut shared between tied winners, conserved', () => {
    const s = computeSettlement({
      payouts: new Map([['p0', 1500], ['p1', 1500]]),
      contributions: new Map([['p0', 1000], ['p1', 1000], ['p2', 1000]]),
      rake,
      flopSeen: true,
    });
    expectConserved(s);
    expect(s.winners).toHaveLength(2);
  });

  it('all-in side pot: main + side winners, conserved', () => {
    // A all-in 500 wins main; B wins the 300 side pot; C loses.
    const s = computeSettlement({
      payouts: new Map([['A', 1500], ['B', 800]]), // A: main 1500, B: side 800
      contributions: new Map([['A', 500], ['B', 1000], ['C', 800]]),
      rake,
      flopSeen: true,
    });
    expectConserved(s);
  });

  it('no-flop-no-drop hand: zero rake, still conserved', () => {
    const s = computeSettlement({
      payouts: new Map([['p0', 30]]),
      contributions: new Map([['p0', 10], ['p1', 10], ['p2', 10]]),
      rake: { bps: 500, cap: 10000, noFlopNoDrop: true },
      flopSeen: false,
    });
    expect(s.rake).toBe(0);
    expectConserved(s);
  });
});

describe('settlement — Financial Core seam', () => {
  it('builds the FC request and would settle through the client', async () => {
    const settlement = computeSettlement({
      payouts: new Map([['p0', 3000]]),
      contributions: new Map([['p0', 1000], ['p1', 1000], ['p2', 1000]]),
      rake,
      flopSeen: true,
    });
    const req = toTableSettlementRequest(settlement, {
      roundId: 'r-1',
      tableType: 'PLATFORM',
      accountOf: (p) => `acc-${p}`,
      jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
    });

    expect(req.winners).toEqual([{ playerAccountId: 'acc-p0', amount: '1840' }]);
    expect(req.losers.map((l) => l.playerAccountId).sort()).toEqual(['acc-p1', 'acc-p2']);
    expect(req.rake).toBe('150');
    expect(req.jackpot.grand).toBe('3'); // floor splits of 10

    // The game server hands this to the Financial Core.
    const fc = { settleTableHand: jest.fn().mockResolvedValue({ roundId: 'r-1', applied: true }) };
    const res = await fc.settleTableHand(req);
    expect(fc.settleTableHand).toHaveBeenCalledWith(req);
    expect(res.applied).toBe(true);
  });
});
