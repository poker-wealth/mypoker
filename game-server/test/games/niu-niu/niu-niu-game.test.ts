import { NiuNiuGame, BankerTakenError } from '../../../src/games/niu-niu/niu-niu-game';
import { evaluateNiu, compareNiu } from '../../../src/games/niu-niu/niu-niu-hand';
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

function newGame(fc = mockFc()): { game: NiuNiuGame; fc: ReturnType<typeof mockFc> } {
  return { game: new NiuNiuGame('nn', fc, new EventBus(), new FakeChainClient(), cfg), fc };
}

describe('NiuNiuGame — banker claim concurrency', () => {
  it('exactly one of several simultaneous banker claims succeeds (SETNX-style)', () => {
    const { game } = newGame();
    const outcomes = ['alice', 'bob', 'carol'].map((id) => {
      try {
        game.claimBanker(id);
        return 'ok';
      } catch (e) {
        return e instanceof BankerTakenError ? 'rejected' : 'error';
      }
    });
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'rejected')).toHaveLength(2);
    expect(game.getBanker()).toBe('alice'); // first claim wins
  });
});

describe('NiuNiuGame — play & settle', () => {
  it('deals 5 each, applies the winning multiplier, nets sum to zero, settles conserved', async () => {
    const { game, fc } = newGame();
    game.claimBanker('dave');
    game.placeBet('alice', 100);
    game.placeBet('bob', 100);
    await game.start();

    expect(game.state).toBe('RESOLVED');
    expect(game.handOf('dave')).toHaveLength(5);

    const bankerRank = evaluateNiu(game.handOf('dave')!);
    for (const p of ['alice', 'bob']) {
      const bettorRank = evaluateNiu(game.handOf(p)!);
      const cmp = compareNiu(bettorRank, bankerRank);
      const expected = cmp > 0 ? 100 * bettorRank.multiplier : -100 * bankerRank.multiplier;
      expect(game.getNet().get(p)).toBe(expected);
    }
    // Banker offsets all bettors → all nets sum to zero.
    expect([...game.getNet().values()].reduce((a, b) => a + b, 0)).toBe(0);

    const req = fc.table[0]!;
    const lost = req.losers.reduce((a, l) => a + Number(l.amount), 0);
    const won = req.winners.reduce((a, w) => a + Number(w.amount), 0);
    const jackpot =
      Number(req.jackpot.mini) + Number(req.jackpot.minor) + Number(req.jackpot.major) + Number(req.jackpot.grand);
    expect(lost).toBe(won + Number(req.rake) + jackpot);
  });

  it('requires a banker and rejects the banker betting', async () => {
    const { game } = newGame();
    game.claimBanker('dave');
    expect(() => game.placeBet('dave', 100)).toThrow(InvalidActionError);
    const { game: g2 } = newGame();
    g2.placeBet('alice', 100);
    await expect(g2.start()).rejects.toThrow(/no banker/);
  });
});
