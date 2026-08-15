import { DouDiZhuGame } from '../../../src/games/dou-di-zhu/dou-di-zhu-game';
import { EventBus } from '../../../src/core/event-bus';
import { FakeChainClient } from '../../../src/fairness';
import type {
  FinancialCoreClient,
  TableSettlementRequest,
} from '../../../src/core/financial-core-client';

/**
 * [money] Dou Di Zhu settlement (SAMUEL.md task 5).
 *
 * `scoreDouDiZhu` was already covered, but only as arithmetic. What was not
 * tested is the part that moves money: that a finished hand reaches
 * financial-core at all, with the right amounts, and that a failure there is
 * not swallowed.
 *
 * The distinction matters. Every other game in this repo awaits its settlement;
 * this one fired it and returned, so a rejected settleTableHand became an
 * unhandled promise rejection that no caller could catch and no test could see.
 * A game can look perfectly correct while the money silently never moved.
 */

/** Captures what the game actually asks financial-core to do. */
function recordingFc(): { fc: FinancialCoreClient; calls: TableSettlementRequest[] } {
  const calls: TableSettlementRequest[] = [];
  return {
    calls,
    fc: {
      async buyIn() {},
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
        calls.push(req);
        return { roundId: req.roundId, applied: true };
      },
    },
  };
}

const baseCfg = {
  baseStake: 100,
  rakeBps: 0,
  tableType: 'PLATFORM' as const,
  accountOf: (p: string) => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};

const players = ['p0', 'p1', 'p2'];

/**
 * Drive a hand to the end by making the landlord dump their whole hand.
 *
 * Single cards only, and the opponents pass every time — the shortest legal
 * route to a finished hand that still goes through the real play/pass path
 * rather than reaching into private state.
 */
async function landlordRunsOut(
  fc: FinancialCoreClient,
  cfg: Partial<typeof baseCfg> = {},
  bidPoints = 2,
): Promise<DouDiZhuGame> {
  const g = new DouDiZhuGame('ddz-settle', fc, new EventBus(), new FakeChainClient(), {
    ...baseCfg,
    ...cfg,
  });
  await g.start(players);
  g.bid('p0', bidPoints);
  g.bid('p1', 0);
  g.bid('p2', 0);

  // p0 is landlord with 20 cards. Lead a single, both pass, lead again.
  for (;;) {
    const hand = g.handOf('p0');
    if (!hand || hand.length === 0) break;
    await g.play('p0', [hand[0]!]);
    if ((g.handOf('p0') ?? []).length === 0) break;
    await g.pass('p1');
    await g.pass('p2');
  }
  return g;
}

describe('[money] Dou Di Zhu settlement', () => {
  it('settles the hand through financial-core when the landlord wins', async () => {
    const { fc, calls } = recordingFc();
    await landlordRunsOut(fc);

    // The assertion the old tests could not make: money was actually asked for.
    expect(calls).toHaveLength(1);
    // The game appends a per-deal suffix, so the round id starts with the table's.
    expect(calls[0]!.roundId).toMatch(/^ddz-settle/);
  });

  it('sends a conserved settlement — the table neither gains nor loses', async () => {
    const { fc, calls } = recordingFc();
    await landlordRunsOut(fc);

    const req = calls[0]!;
    const paidIn = req.losers.reduce((sum, l) => sum + Number(l.amount), 0);
    const paidOut = req.winners.reduce((sum, w) => sum + Number(w.amount), 0);
    const rake = Number(req.rake ?? 0);
    const jackpot = Object.values(req.jackpot).reduce((sum, v) => sum + Number(v), 0);

    // The invariant financial-core states on TableSettlementRequest itself:
    // Σ(losers) = Σ(winners) + rake + Σ(jackpot). Player-funded — the platform
    // adds nothing — so a mismatch is money created or destroyed at a table.
    //
    // The jackpot term is easy to forget and this test did at first: even with
    // rake at zero, 0.5% of the winnings is injected into the pools (§5), so
    // winners + rake alone does NOT balance and should not.
    expect(paidIn).toBe(paidOut + rake + jackpot);
    expect(jackpot).toBeGreaterThan(0);
  });

  it('scales the stake by the bid — 3 points is three times 1 point', async () => {
    const one = recordingFc();
    await landlordRunsOut(one.fc, {}, 1);
    const three = recordingFc();
    await landlordRunsOut(three.fc, {}, 3);

    const total = (r: TableSettlementRequest): number =>
      r.losers.reduce((sum, l) => sum + Number(l.amount), 0);

    expect(total(three.calls[0]!)).toBe(total(one.calls[0]!) * 3);
  });

  it('takes rake from the pot, not from thin air', async () => {
    const free = recordingFc();
    await landlordRunsOut(free.fc, { rakeBps: 0 });
    const raked = recordingFc();
    await landlordRunsOut(raked.fc, { rakeBps: 500 });

    const stakeIn = (r: TableSettlementRequest): number =>
      r.losers.reduce((sum, l) => sum + Number(l.amount), 0);

    // The losers pay the same either way — rake comes out of the winnings, so a
    // raked table must not quietly charge the losers more.
    expect(stakeIn(raked.calls[0]!)).toBe(stakeIn(free.calls[0]!));
    expect(Number(raked.calls[0]!.rake ?? 0)).toBeGreaterThan(0);
  });

  it('names every player by their ACCOUNT, never their playerId', async () => {
    const { fc, calls } = recordingFc();
    await landlordRunsOut(fc);

    // accountOf is the seam between a game and the ledger. A playerId leaking
    // into a settlement would credit an account that does not exist, or worse,
    // one that does and belongs to somebody else.
    const named = [
      ...calls[0]!.winners.map((w) => w.playerAccountId),
      ...calls[0]!.losers.map((l) => l.playerAccountId),
    ];
    expect(named.every((id) => id.startsWith('acc-'))).toBe(true);
  });

  it('does not swallow a settlement failure', async () => {
    // THE ONE THAT MATTERS. Every other game awaits its settlement; this one
    // fired and forgot, so a financial-core outage produced an unhandled
    // rejection instead of an error anyone could act on — and the hand still
    // reported as finished.
    const failing: FinancialCoreClient = {
      ...recordingFc().fc,
      async settleTableHand() {
        throw new Error('financial-core unavailable');
      },
    };

    await expect(landlordRunsOut(failing)).rejects.toThrow(/financial-core unavailable/);
  });

  it('settles exactly once, however the hand ends', async () => {
    const { fc, calls } = recordingFc();
    await landlordRunsOut(fc);

    // Two settlements for one hand would pay the winners twice.
    expect(calls).toHaveLength(1);
  });
});
