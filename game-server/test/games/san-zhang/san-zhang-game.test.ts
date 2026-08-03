import { SanZhangGame } from '../../../src/games/san-zhang/san-zhang-game';
import { evaluate3, compare3 } from '../../../src/games/san-zhang/san-zhang-hand';
import { EventBus } from '../../../src/core/event-bus';
import { FakeChainClient } from '../../../src/fairness';
import { InvalidActionError } from '../../../src/core/base-game';
import type {
  FinancialCoreClient,
  TableSettlementRequest,
} from '../../../src/core/financial-core-client';

function mockFc(): FinancialCoreClient & { table: TableSettlementRequest[] } {
  const table: TableSettlementRequest[] = [];
  return {
    table,
    async buyIn() {},
    async release() {},
    async settleRound(req) {
      return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
    },
    async settleTableHand(req) {
      table.push(req);
      return { roundId: req.roundId, applied: true };
    },
  };
}

const cfg = {
  rakeBps: 500,
  tableType: 'PLATFORM' as const,
  accountOf: (p: string) => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};

describe('SanZhangGame — player-banked', () => {
  function newGame(fc = mockFc()): { game: SanZhangGame; fc: ReturnType<typeof mockFc> } {
    return { game: new SanZhangGame('sz', fc, new EventBus(), new FakeChainClient(), cfg), fc };
  }

  it('deals 3 cards each, compares to the banker, and nets sum to zero', async () => {
    const { game, fc } = newGame();
    game.setBanker('dave');
    game.placeBet('alice', 100);
    game.placeBet('bob', 100);
    await game.start();

    expect(game.state).toBe('RESOLVED');
    expect(game.handOf('dave')).toHaveLength(3);
    expect(game.handOf('alice')).toHaveLength(3);

    // Each bettor's net sign matches the actual comparison to the banker.
    const bankerRank = evaluate3(game.handOf('dave')!);
    for (const p of ['alice', 'bob']) {
      const cmp = compare3(evaluate3(game.handOf(p)!), bankerRank);
      const net = game.getNet().get(p)!;
      expect(Math.sign(net)).toBe(Math.sign(cmp));
    }
    // All nets sum to zero — banker offsets the bettors; platform is not a party.
    expect([...game.getNet().values()].reduce((a, b) => a + b, 0)).toBe(0);

    // Settled through the player-funded FC path, conserved.
    const req = fc.table[0]!;
    const lost = req.losers.reduce((a, l) => a + Number(l.amount), 0);
    const won = req.winners.reduce((a, w) => a + Number(w.amount), 0);
    const jackpot =
      Number(req.jackpot.mini) + Number(req.jackpot.minor) + Number(req.jackpot.major) + Number(req.jackpot.grand);
    expect(lost).toBe(won + Number(req.rake) + jackpot);
  });

  it('the banker cannot bet and a banker is required to deal', async () => {
    const { game } = newGame();
    game.setBanker('dave');
    expect(() => game.placeBet('dave', 100)).toThrow(InvalidActionError);
    const { game: g2 } = newGame();
    g2.placeBet('alice', 100);
    await expect(g2.start()).rejects.toThrow(/no banker/);
  });

  it('reveals hands only at showdown', async () => {
    const { game } = newGame();
    game.setBanker('dave');
    game.placeBet('alice', 100);
    const pre = game.getPublicState('alice') as { yourHand: string[] | null; hands?: unknown };
    expect(pre.yourHand).toBeNull(); // not dealt yet during betting
    expect(pre.hands).toBeUndefined();

    await game.start();
    const post = game.getPublicState('alice') as { yourHand: string[] | null; hands?: unknown };
    expect(post.yourHand).toHaveLength(3);
    expect(post.hands).toBeDefined(); // all hands shown at showdown
  });
});
