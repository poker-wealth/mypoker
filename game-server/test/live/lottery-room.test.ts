import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { LotteryRoom } from '../../src/live/lottery-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type {
  FinancialCoreClient,
  SettlementFailureReport,
  TableSettlementRequest,
} from '../../src/core/financial-core-client';

/** Captures the roundId of every settleTableHand call, without regard to whether it was applied. */
function recordingFc(): { fc: FinancialCoreClient; roundIds: string[] } {
  const roundIds: string[] = [];
  return {
    roundIds,
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
      async settleTableHand(req: TableSettlementRequest) {
        roundIds.push(req.roundId);
        return { roundId: req.roundId, applied: true };
      },
    },
  };
}

const BUY_IN = 2_000;

const wait = (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for state');
}

describe('LotteryRoom — Live Room Integration', () => {
  it('registers lottery table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const lotTable = hub.tables().find((t) => t.tableId === 'lottery');
    expect(lotTable).toBeDefined();
    expect(lotTable?.variant).toBe('Lottery');
    await hub.close();
  });

  it('seats two players, buys tickets, resolves draw, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new LotteryRoom(
      {
        id: 'lottery-1',
        name: 'Test Lottery',
        game: 'lottery',
        range: 5,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Alice buys ticket #0, Bob buys ticket #1
    await room.command(alice, { kind: 'act', action: { type: '0', amount: 100 } });
    await room.command(bob, { kind: 'act', action: { type: '1', amount: 100 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN');

    const snap = room.snapshotFor(alice);
    expect(snap.phase).toBe('SHOWDOWN');

    // Verify ledger-level money conservation including rake sink
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);

  // BUG-01: `maybeStartRound` builds a fresh LotteryGame every round with the SAME config.id as
  // roomId. Before the fix that made FC's per-round roundId collide across rounds, not just across
  // room instances — a repeat FC treats as an already-applied settlement (idempotency key), replaying
  // chips silently instead of moving new ones.
  it('sends a different roundId to FC on each of two consecutive rounds', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const { fc, roundIds } = recordingFc();
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;

    const room = new LotteryRoom(
      {
        id: 'lottery-roundid',
        name: 'Test Lottery',
        game: 'lottery',
        // range: 2 with one ticket on each number guarantees exactly one winner and one loser every
        // draw — never a void round — so settleTableHand fires deterministically each time.
        range: 2,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    for (let round = 0; round < 2; round++) {
      const target = round + 1;
      await until(() => {
        const s = room.snapshotFor(alice);
        return s.handNumber === target && s.phase === 'IN_HAND';
      }, 10_000);

      await room.command(alice, { kind: 'act', action: { type: '0', amount: 100 } });
      await room.command(bob, { kind: 'act', action: { type: '1', amount: 100 } });

      await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);
    }

    expect(roundIds).toHaveLength(2);
    expect(roundIds[0]).not.toBe(roundIds[1]);

    room.dispose();
  }, 20_000);
});

/**
 * BUG-11: `resolveRound` called `game.start()` (which settles via FC) with no try/catch. A rejected
 * settlement — the ledger unreachable, a 409 — left the table stuck IN_HAND forever: nothing resets
 * `phase`, and a seat's `stack` mirror is only written by the net-delta loop AFTER `game.start()`
 * resolves, so a throw from it means no stack moved either. Mirrors the niu-niu-room recovery and
 * PokerRoom's own BUG-03 fix: `abandonRound` puts the table back to WAITING and reports the failure,
 * and the table deals again on its own rather than sitting dead.
 */
describe('LotteryRoom — settlement failure recovery (BUG-11)', () => {
  it('recovers to WAITING with stacks unchanged, reports the failure, and deals again', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;

    const realSettle = bank.settleTableHand.bind(bank);
    let calls = 0;
    bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('financial-core unreachable'));
      return realSettle(req);
    };
    const reportSpy = jest.fn<Promise<void>, [SettlementFailureReport]>().mockResolvedValue(undefined);
    (bank as unknown as { reportSettlementFailure: typeof reportSpy }).reportSettlementFailure = reportSpy;

    const room = new LotteryRoom(
      {
        id: 'lottery-bug11',
        name: 'Test Lottery',
        game: 'lottery',
        // range: 2 with one ticket on each number guarantees exactly one winner and one loser every
        // draw — never a void round — so settleTableHand (and therefore the injected failure) fires
        // deterministically instead of leaving this test racing the draw.
        range: 2,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    const before = new Map(room.snapshotFor(alice).seats.map((s) => [s.playerId, s.stack]));
    await room.command(alice, { kind: 'act', action: { type: '0', amount: 100 } });
    await room.command(bob, { kind: 'act', action: { type: '1', amount: 100 } });

    await until(() => room.snapshotFor(alice).phase === 'WAITING');
    for (const seat of room.snapshotFor(alice).seats) {
      expect(seat.stack).toBe(before.get(seat.playerId));
    }
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]![0]).toMatchObject({
      tableId: 'lottery-bug11',
      reason: expect.stringContaining('financial-core unreachable'),
    });

    // The table recovers rather than freezing — a second hand deals on its own.
    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 2,
      10_000,
    );
    room.dispose();
  }, 15_000);
});
