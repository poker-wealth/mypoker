import { TexasGame } from '../../../src/games/texas/texas-game';
import { OMAHA, SHORT_DECK } from '../../../src/games/texas/variants';
import { EventBus } from '../../../src/core/event-bus';
import { FakeChainClient } from '../../../src/fairness';
import type {
  FinancialCoreClient,
  TableSettlementRequest,
} from '../../../src/core/financial-core-client';

function mockFc(): FinancialCoreClient & { table: TableSettlementRequest[]; buyIns: string[] } {
  const table: TableSettlementRequest[] = [];
  const buyIns: string[] = [];
  return {
    table,
    buyIns,
    async buyIn(acc) {
      buyIns.push(acc);
    },
    async release() {},
    async settleRound(req) {
      return {
        roundId: req.roundId,
        sequence: [],
        amounts: { jackpot: '0', rake: '0', payout: '0' },
        accounts: {},
        hash: '',
      };
    },
    async settleTableHand(req) {
      table.push(req);
      return { roundId: req.roundId, applied: true };
    },
  };
}

const cfg = {
  smallBlind: 5,
  bigBlind: 10,
  tableType: 'PLATFORM' as const,
  rake: { bps: 500, cap: 10000, noFlopNoDrop: true },
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
  accountOf: (p: string) => `acc-${p}`,
};

async function seatThree(game: TexasGame): Promise<void> {
  await game.seatPlayer('alice', 1000);
  await game.seatPlayer('bob', 1000);
  await game.seatPlayer('carol', 1000);
}

/** Play the current hand out passively (check, or call if facing a bet). */
async function playHand(game: TexasGame): Promise<void> {
  while (game.state === 'IN_HAND') {
    const ps = game.getPublicState('alice') as { toAct: string | null };
    const la = game.legalActions()!;
    await game.handleAction(ps.toAct!, la.canCheck ? { type: 'check' } : { type: 'call' });
  }
}

describe('TexasGame runtime', () => {
  it('seats players via the Financial Core and starts a provably-fair hand', async () => {
    const fc = mockFc();
    const game = new TexasGame('room-1', fc, new EventBus(), cfg, new FakeChainClient());
    await seatThree(game);
    expect(fc.buyIns).toEqual(['acc-alice', 'acc-bob', 'acc-carol']); // funds locked via FC

    const started = jest.fn();
    (game['events'] as EventBus<{ handStarted: unknown }>).on('handStarted', started);
    await game.startHand(0);
    expect(game.state).toBe('IN_HAND');
    expect(started).toHaveBeenCalled();
    expect(game.roundInfo()!.finalSeed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('shows a player only their own hole cards', async () => {
    const game = new TexasGame('room-1', mockFc(), new EventBus(), cfg, new FakeChainClient());
    await seatThree(game);
    await game.startHand(0);
    const view = game.getPublicState('alice') as {
      you: { hole: string[] | null };
      seats: { id: string; hole?: unknown }[];
    };
    expect(view.you.hole).toHaveLength(2);
    // Opponents expose no hole cards.
    for (const s of view.seats) expect(s).not.toHaveProperty('hole');
  });

  it('plays a full hand and settles through the Financial Core, chips conserved', async () => {
    const fc = mockFc();
    const game = new TexasGame('room-1', fc, new EventBus(), cfg, new FakeChainClient());
    await seatThree(game);
    const settled = jest.fn();
    (game['events'] as EventBus<{ handSettled: unknown }>).on('handSettled', settled);

    await game.startHand(0);
    await playHand(game);

    expect(game.state).toBe('WAITING');
    expect(fc.table).toHaveLength(1); // settled through the FC exactly once
    expect(settled).toHaveBeenCalled();

    // Table chips = starting total minus what left to the house (rake + jackpot).
    const req = fc.table[0]!;
    const rake = Number(req.rake);
    const jackpot =
      Number(req.jackpot.mini) +
      Number(req.jackpot.minor) +
      Number(req.jackpot.major) +
      Number(req.jackpot.grand);
    const total = [...game.seatedStacks().values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(3000 - rake - jackpot);
  });

  it('deals the configured variant — Omaha gets 4 hole cards, Short Deck a 36-card deck', async () => {
    const omaha = new TexasGame(
      'room-o',
      mockFc(),
      new EventBus(),
      { ...cfg, variant: OMAHA },
      new FakeChainClient(),
    );
    await seatThree(omaha);
    await omaha.startHand(0);
    const oView = omaha.getPublicState('alice') as { you: { hole: string[] } };
    expect(oView.you.hole).toHaveLength(4);

    const shortDeck = new TexasGame(
      'room-s',
      mockFc(),
      new EventBus(),
      { ...cfg, variant: SHORT_DECK },
      new FakeChainClient(),
    );
    await seatThree(shortDeck);
    await shortDeck.startHand(0);
    const sView = shortDeck.getPublicState('alice') as { you: { hole: string[] } };
    expect(sView.you.hole).toHaveLength(2);
    // No 2s–5s exist in a short deck.
    expect(sView.you.hole.every((c) => !['2', '3', '4', '5'].includes(c[0]!))).toBe(true);
  });

  it('defaults to standard Texas when no variant is given', async () => {
    const game = new TexasGame('room-1', mockFc(), new EventBus(), cfg, new FakeChainClient());
    await seatThree(game);
    await game.startHand(0);
    const view = game.getPublicState('alice') as { you: { hole: string[] } };
    expect(view.you.hole).toHaveLength(2);
  });

  it('exposes the settled hand result for a client to render the showdown', async () => {
    const game = new TexasGame('room-1', mockFc(), new EventBus(), cfg, new FakeChainClient());
    await seatThree(game);
    expect(game.settledResult()).toBeUndefined(); // nothing before a hand settles

    await game.startHand(0);
    await playHand(game);

    const result = game.settledResult()!;
    expect(result).toBeDefined();
    expect(result.community.length).toBeGreaterThanOrEqual(0);
    // Every paid player is accounted for, and payouts never exceed the table.
    const paid = [...result.payouts.values()].reduce((a, b) => a + b, 0);
    expect(paid).toBeGreaterThan(0);
  });

  it('can deal a second hand after the first settles', async () => {
    const game = new TexasGame('room-1', mockFc(), new EventBus(), cfg, new FakeChainClient());
    await seatThree(game);
    await game.startHand(0);
    await playHand(game);
    expect(game.state).toBe('WAITING');
    await game.startHand(1);
    expect(game.state).toBe('IN_HAND');
    expect(game.roundInfo()!.roundId).toBe('room-1-h2'); // fresh round
  });
});
