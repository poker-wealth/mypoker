import { CowboyBeautyGame } from '../../../src/games/cowboy-beauty/cowboy-beauty-game';
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
  rakeBps: 0,
  tableType: 'PLATFORM' as const,
  accountOf: (p: string) => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};

function newGame(startHeight = 1000): { g: CowboyBeautyGame; chain: FakeChainClient } {
  const chain = new FakeChainClient(startHeight);
  return { g: new CowboyBeautyGame('cb', fc, new EventBus(), chain, cfg), chain };
}
const sum = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);

describe('CowboyBeautyGame — odds & the T−5s freeze', () => {
  it('odds move as bets arrive, then lock at freeze', async () => {
    const { g } = newGame();
    g.placeBet('a', 'COWBOY', 100);
    expect(g.getOddsBps()).toEqual({ COWBOY: 10000, BEAUTY: null }); // 1.00×, beauty unbacked
    g.placeBet('b', 'BEAUTY', 100);
    expect(g.getOddsBps()).toEqual({ COWBOY: 20000, BEAUTY: 20000 }); // 2.00× each
    const live = g.getOddsBps();
    await g.freeze();
    expect(g.getOddsBps()).toEqual(live); // locked at the values shown when betting closed
  });

  it('rejects bets once frozen — nobody can bet into a closing round', async () => {
    const { g } = newGame();
    g.placeBet('a', 'COWBOY', 100);
    g.placeBet('b', 'BEAUTY', 100);
    await g.freeze();
    expect(() => g.placeBet('c', 'COWBOY', 100)).toThrow(InvalidActionError);
    expect(() => g.placeBet('a', 'BEAUTY', 1)).toThrow(/betting is closed/);
  });

  it('cannot draw before the odds freeze', async () => {
    const { g } = newGame();
    g.placeBet('a', 'COWBOY', 100);
    await expect(g.start()).rejects.toThrow(/not frozen/);
  });

  it('pins a block that is not yet mined when betting closes', async () => {
    const { g, chain } = newGame(1000);
    g.placeBet('a', 'COWBOY', 100);
    g.placeBet('b', 'BEAUTY', 100);
    await g.freeze();
    // freeze() read height 1000 and pinned 1001 — the result cannot exist while bets are open.
    expect(g.getDrawBlock()).toBe(1001);
    expect(await chain.getBlockHash(1001)).toBeDefined();
  });
});

describe('CowboyBeautyGame — draw & settlement', () => {
  it('draws a winner and settles the pool, conserved to the chip', async () => {
    const { g } = newGame();
    g.placeBet('a', 'COWBOY', 100);
    g.placeBet('b', 'BEAUTY', 300);
    await g.freeze();
    await g.start();

    const winner = g.getWinner()!;
    expect(['COWBOY', 'BEAUTY', 'TIE']).toContain(winner);
    expect(g.getCards()!.cowboy).not.toBe(g.getCards()!.beauty);
    const net = g.getNet();
    expect(sum(net)).toBe(0);
    if (winner === 'COWBOY') expect(net.get('a')).toBe(300);
    else if (winner === 'BEAUTY') expect(net.get('b')).toBe(100);
    else expect(net.size).toBe(0); // tie → round void, stakes stay put
  });

  it('invariants hold across many independent rounds', async () => {
    for (let i = 0; i < 30; i++) {
      const { g } = newGame(1000 + i);
      g.placeBet('a', 'COWBOY', 150);
      g.placeBet('b', 'BEAUTY', 250);
      await g.freeze();
      await g.start();
      const net = g.getNet();
      expect(sum(net)).toBe(0); // never creates or destroys money
      if (g.getWinner() === 'TIE') expect(net.size).toBe(0);
      else expect([...net.values()].some((n) => n > 0)).toBe(true);
    }
  });

  it('cannot draw twice', async () => {
    const { g } = newGame();
    g.placeBet('a', 'COWBOY', 100);
    g.placeBet('b', 'BEAUTY', 100);
    await g.freeze();
    await g.start();
    await expect(g.start()).rejects.toThrow(/already drawn/);
    await expect(g.freeze()).rejects.toThrow(/already frozen/);
  });
});
