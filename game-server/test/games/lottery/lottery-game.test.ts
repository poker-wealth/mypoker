import { LotteryGame, resolveDraw, drawNumber, type Ticket } from '../../../src/games/lottery/lottery-game';
import { EventBus } from '../../../src/core/event-bus';
import { FakeChainClient } from '../../../src/fairness';
import { InvalidActionError } from '../../../src/core/base-game';
import type { FinancialCoreClient } from '../../../src/core/financial-core-client';

const fc: FinancialCoreClient = {
  async buyIn() {},
  async release() {},
  async settleRound(req) {
    return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
  },
  async settleTableHand(req) {
    return { roundId: req.roundId, applied: true };
  },
};

const cfg = {
  range: 10,
  rakeBps: 0,
  tableType: 'PLATFORM' as const,
  accountOf: (p: string) => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};

const t = (playerId: string, number: number, amount: number): Ticket => ({ playerId, number, amount });
const sum = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);
const newGame = (h = 1000): LotteryGame =>
  new LotteryGame('lot', fc, new EventBus(), new FakeChainClient(h), cfg);

describe('drawNumber', () => {
  it('is deterministic and always in range', () => {
    expect(drawNumber('seed-x', 10)).toBe(drawNumber('seed-x', 10));
    for (let i = 0; i < 200; i++) {
      const n = drawNumber(`s${i}`, 10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
    }
  });

  it('draws every number roughly evenly — no number is favoured', () => {
    const counts = new Array(10).fill(0) as number[];
    const N = 20_000;
    for (let i = 0; i < N; i++) counts[drawNumber(`u${i}`, 10)]!++;
    // Expect ~2000 each; a biased draw (e.g. modulo bias) would skew the low numbers.
    for (const c of counts) expect(Math.abs(c - N / 10)).toBeLessThan(N / 10 / 5);
  });
});

describe('resolveDraw', () => {
  it('winners split the losing pool pro-rata; sums to zero', () => {
    const net = resolveDraw([t('a', 7, 100), t('b', 7, 300), t('c', 3, 200)], 7);
    expect(net.get('a')).toBe(50);
    expect(net.get('b')).toBe(150);
    expect(net.get('c')).toBe(-200);
    expect(sum(net)).toBe(0);
  });

  it('nets a player who holds both a winning and a losing ticket', () => {
    const net = resolveDraw([t('a', 7, 100), t('a', 3, 40), t('b', 3, 60)], 7);
    // 'a' wins the whole 100 losing pool, minus their own 40 loss → +60; 'b' loses 60.
    expect(net.get('a')).toBe(60);
    expect(net.get('b')).toBe(-60);
    expect(sum(net)).toBe(0);
  });

  it('voids when nobody wins, or when nobody loses', () => {
    expect(resolveDraw([t('a', 1, 100), t('b', 2, 100)], 9).size).toBe(0); // no winner
    expect(resolveDraw([t('a', 7, 100), t('b', 7, 100)], 7).size).toBe(0); // no loser
  });
});

describe('LotteryGame', () => {
  it('sells tickets, draws, and settles — conserved', async () => {
    const g = newGame();
    g.buyTicket('a', 0, 100);
    g.buyTicket('b', 1, 100);
    g.buyTicket('c', 2, 100);
    expect(g.getPool()).toBe(300);
    await g.start();

    const n = g.getWinningNumber()!;
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(10);
    expect(sum(g.getNet())).toBe(0); // never creates or destroys money
    if (n > 2) expect(g.getNet().size).toBe(0); // nobody held it → void, all refunded
    else expect(g.getNet().size).toBe(3);
  });

  it('rejects bad tickets, and any ticket after the draw', async () => {
    const g = newGame();
    expect(() => g.buyTicket('a', 10, 100)).toThrow(InvalidActionError); // out of range
    expect(() => g.buyTicket('a', -1, 100)).toThrow(/out of range/);
    expect(() => g.buyTicket('a', 0, 0)).toThrow(/stake must be positive/);
    g.buyTicket('a', 0, 100);
    g.buyTicket('b', 1, 100);
    await g.start();
    expect(() => g.buyTicket('c', 0, 100)).toThrow(/draw has closed/);
    await expect(g.start()).rejects.toThrow(/already drawn/);
  });

  it('will not draw with no tickets sold', async () => {
    await expect(newGame().start()).rejects.toThrow(/no tickets sold/);
  });

  it('money is conserved across many independent draws', async () => {
    for (let i = 0; i < 25; i++) {
      const g = newGame(1000 + i);
      g.buyTicket('a', 3, 150);
      g.buyTicket('b', 3, 50);
      g.buyTicket('c', 4, 200);
      await g.start();
      expect(sum(g.getNet())).toBe(0);
    }
  });
});
