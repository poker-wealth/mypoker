import { BaccaratGame, grossResult } from '../../../src/games/baccarat/baccarat-game';
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
  tiePayout: 8,
  tableType: 'PLATFORM' as const,
  accountOf: (p: string) => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};

describe('baccarat gross results (bettor vs banker player, no house)', () => {
  it('player bet: 1:1 win, push on tie, loss on banker', () => {
    expect(grossResult({ betType: 'player', amount: 100 }, 'PLAYER', 8)).toBe(100);
    expect(grossResult({ betType: 'player', amount: 100 }, 'TIE', 8)).toBe(0);
    expect(grossResult({ betType: 'player', amount: 100 }, 'BANKER', 8)).toBe(-100);
  });
  it('banker bet: 1:1 (commission is the platform rake, not withheld here)', () => {
    expect(grossResult({ betType: 'banker', amount: 100 }, 'BANKER', 8)).toBe(100);
    expect(grossResult({ betType: 'banker', amount: 100 }, 'PLAYER', 8)).toBe(-100);
  });
  it('tie bet: 8:1', () => {
    expect(grossResult({ betType: 'tie', amount: 100 }, 'TIE', 8)).toBe(800);
    expect(grossResult({ betType: 'tie', amount: 100 }, 'PLAYER', 8)).toBe(-100);
  });
});

describe('BaccaratGame — player-banked', () => {
  function newGame(fc = mockFc()): { game: BaccaratGame; fc: ReturnType<typeof mockFc> } {
    return { game: new BaccaratGame('bacc', fc, new EventBus(), new FakeChainClient(), cfg), fc };
  }

  it('a player banks; the banker cannot bet; platform is never a party', async () => {
    const { game, fc } = newGame();
    game.setBanker('dave');
    expect(() => game.placeBet('dave', 'player', 100)).toThrow(InvalidActionError);
    game.placeBet('alice', 'player', 100);
    game.placeBet('bob', 'banker', 100);

    await game.start();
    expect(game.state).toBe('RESOLVED');

    // All player nets sum to zero — the banker offsets the bettors; the platform is not a party.
    const net = game.getNet();
    const total = [...net.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(0);

    // Settled through the shared player-funded FC path; only rake + jackpot go to the platform.
    expect(fc.table).toHaveLength(1);
    const req = fc.table[0]!;
    const lost = req.losers.reduce((a, l) => a + Number(l.amount), 0);
    const won = req.winners.reduce((a, w) => a + Number(w.amount), 0);
    const jackpot =
      Number(req.jackpot.mini) + Number(req.jackpot.minor) + Number(req.jackpot.major) + Number(req.jackpot.grand);
    expect(lost).toBe(won + Number(req.rake) + jackpot); // conserved
  });

  it('requires a banker before dealing', async () => {
    const { game } = newGame();
    game.placeBet('alice', 'player', 100);
    await expect(game.start()).rejects.toThrow(/no banker/);
  });

  it('hides cards until resolved and reopens for the next round', async () => {
    const { game } = newGame();
    game.setBanker('dave');
    game.placeBet('alice', 'player', 100);
    const pre = game.getPublicState('alice') as { outcome: unknown; banker: string };
    expect(pre.outcome).toBeNull();
    expect(pre.banker).toBe('dave');

    await game.start();
    expect(() => game.placeBet('bob', 'player', 50)).toThrow(InvalidActionError);
    game.nextRound();
    expect(game.state).toBe('BETTING');
  });
});
