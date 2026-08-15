import { EventBus } from '../../../src/core/event-bus';
import { FakeChainClient } from '../../../src/fairness';
import { TexasGame } from '../../../src/games/texas/texas-game';
import { mergeClientSeeds } from '../../../src/fairness/seed';
import type { FinancialCoreClient } from '../../../src/core/financial-core-client';

/**
 * Player-supplied client seeds (provable fairness): a player's own device-generated seed is what
 * enters the shuffle for their seat, so the platform cannot choose the randomness they rely on.
 * Additive — a seat that supplies nothing still gets a server seed, so existing behaviour is unchanged.
 */

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

function newGame(): TexasGame {
  return new TexasGame(
    'room-cs',
    fc,
    new EventBus(),
    {
      tableType: 'PLATFORM',
      accountOf: (p: string) => `acc-${p}`,
      jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
      smallBlind: 10,
      bigBlind: 20,
      rake: { bps: 500, cap: 100_000, noFlopNoDrop: true },
    },
    new FakeChainClient(),
  );
}

const SEED_A = 'a'.repeat(64);

describe('TexasGame — player-supplied client seeds', () => {
  it('uses a supplied seed for that seat and a server seed for a seat that supplied none', async () => {
    const g = newGame();
    await g.seatPlayer('p1', 1000);
    await g.seatPlayer('p2', 1000);
    g.setClientSeed('p1', SEED_A);
    await g.startHand();

    const seats = g.roundInfo()!.seats;
    expect(seats[0]!.clientSeed).toBe(SEED_A); // p1's own seed, used verbatim
    expect(seats[1]!.clientSeed).toMatch(/^[0-9a-f]{64}$/); // p2 fell back to a server seed
    expect(seats[1]!.clientSeed).not.toBe(SEED_A);
    // The published seats are exactly what fed the shuffle — the merge is verifiable from them.
    expect(g.roundInfo()!.allClientSeeds).toBe(mergeClientSeeds(seats));
  });

  it('applies the supplied seed to subsequent hands until changed', async () => {
    const g = newGame();
    await g.seatPlayer('p1', 1000);
    await g.seatPlayer('p2', 1000);
    g.setClientSeed('p1', SEED_A);

    await g.startHand();
    expect(g.roundInfo()!.seats[0]!.clientSeed).toBe(SEED_A);
    // Finish and deal again — the seed persists.
    while (g.legalActions()) {
      const actor = (g.getPublicState('p1') as { toAct?: string | null }).toAct;
      if (!actor) break;
      await g.handleAction(actor, g.legalActions()!.canCheck ? { type: 'check' } : { type: 'call' });
    }
    await g.startHand(1);
    expect(g.roundInfo()!.seats[0]!.clientSeed).toBe(SEED_A);
  });

  it('rejects a malformed seed and an unseated player', async () => {
    const g = newGame();
    await g.seatPlayer('p1', 1000);
    expect(() => g.setClientSeed('p1', 'not-hex')).toThrow(/hex/);
    expect(() => g.setClientSeed('p1', 'abc')).toThrow(/hex/);
    expect(() => g.setClientSeed('ghost', SEED_A)).toThrow(/not seated/);
  });
});
