import {
  DouDiZhuGame,
  scoreDouDiZhu,
} from '../../../src/games/dou-di-zhu/dou-di-zhu-game';
import { build54Deck } from '../../../src/games/dou-di-zhu/ddz-deck';
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
  baseStake: 100,
  rakeBps: 0,
  tableType: 'PLATFORM' as const,
  accountOf: (p: string) => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};

const players = ['p0', 'p1', 'p2'];
function newGame(): DouDiZhuGame {
  return new DouDiZhuGame('ddz', fc, new EventBus(), new FakeChainClient(), cfg);
}
async function dealt(): Promise<DouDiZhuGame> {
  const g = newGame();
  await g.start(players);
  return g;
}

describe('scoreDouDiZhu', () => {
  it('landlord win: +2·stake, each peasant −stake, conserved', () => {
    const net = scoreDouDiZhu(true, 'p1', players, 100);
    expect(net.get('p1')).toBe(200);
    expect(net.get('p0')).toBe(-100);
    expect(net.get('p2')).toBe(-100);
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('peasant win: landlord −2·stake, each peasant +stake, conserved', () => {
    const net = scoreDouDiZhu(false, 'p1', players, 100);
    expect(net.get('p1')).toBe(-200);
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('DouDiZhuGame — deal & bidding', () => {
  it('deals 17 to each + 3 to the bottom, all 54 distinct', async () => {
    const g = await dealt();
    const all = new Set<string>();
    for (const p of players) {
      expect(g.handOf(p)).toHaveLength(17);
      g.handOf(p)!.forEach((c) => all.add(c));
    }
    // the bottom 3 are hidden until a landlord takes them, but the full deck is 54 distinct
    expect(new Set(build54Deck()).size).toBe(54);
    expect(all.size).toBe(51); // 3×17 before the landlord takes the bottom
  });

  it('highest bidder becomes landlord and takes the bottom (20 cards)', async () => {
    const g = await dealt();
    g.bid('p0', 1);
    g.bid('p1', 3);
    g.bid('p2', 0);
    expect(g.getLandlord()).toBe('p1');
    expect(g.handOf('p1')).toHaveLength(20); // 17 + 3 bottom
    expect(g.getTurn()).toBe('p1'); // landlord leads
  });
});

describe('DouDiZhuGame — play & pass', () => {
  async function toPlay(): Promise<DouDiZhuGame> {
    const g = await dealt();
    g.bid('p0', 2);
    g.bid('p1', 0);
    g.bid('p2', 0);
    return g; // p0 is landlord, leads
  }

  it('the landlord leads with a legal play; opponents can pass back', async () => {
    const g = await toPlay();
    const lead = [g.handOf('p0')![0]!]; // a single is always legal
    g.play('p0', lead);
    expect(g.getTurn()).toBe('p1');
    await g.pass('p1');
    await g.pass('p2');
    expect(g.getTurn()).toBe('p0'); // both passed → back to the leader
  });

  it('rejects out-of-turn, not-in-hand, and leading-pass', async () => {
    const g = await toPlay();
    expect(() => g.play('p1', [g.handOf('p1')![0]!])).toThrow(InvalidActionError); // not their turn
    expect(() => g.play('p0', ['ZZ'])).toThrow(InvalidActionError); // card not in hand
    await expect(g.pass('p0')).rejects.toThrow(/cannot pass when leading/); // leader can't pass
  });
});
