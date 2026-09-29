import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { SanZhangRoom } from '../../src/live/san-zhang-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type { TableSettlementRequest } from '../../src/core/financial-core-client';

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

describe('SanZhangRoom — Live Room Integration', () => {
  it('registers san-zhang table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const szTable = hub.tables().find((t) => t.tableId === 'san-zhang');
    expect(szTable).toBeDefined();
    expect(szTable?.variant).toBe('San Zhang');
    await hub.close();
  });

  it('seats two players, resolves hand, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new SanZhangRoom(
      {
        id: 'san-zhang-1',
        name: 'Test San Zhang',
        game: 'san-zhang',
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

    // Bob bets
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN');

    const snap = room.snapshotFor(alice);
    expect(snap.phase).toBe('SHOWDOWN');

    // Verify ledger-level money conservation including rake sink
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);
});

/**
 * BUG-26: San Zhang reused one `SanZhangGame` for the room's whole lifetime, advancing it with
 * `nextRound()` only on the success path (`nextRound()` requires RESOLVED). After an abandoned
 * round — settlement refused, or a later step like the jackpot throwing — the instance was left
 * mid-state, and the next round's `setBanker`/`placeBet` threw forever: a single failed settlement
 * wedged the table for good, the same shape as the baccarat/niu-niu fix this mirrors.
 */
describe('SanZhangRoom — a fresh game per round survives an abandon (BUG-26)', () => {
  it('deals and settles again after settlement fails once, for two rounds in a row', async () => {
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

    const room = new SanZhangRoom(
      {
        id: 'san-zhang-bug26-settle-fails',
        name: 'Test San Zhang',
        game: 'san-zhang',
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

    // Round 1: the bettor's action triggers `resolveRound`, whose settlement fails (calls === 1).
    // Before the fix, the reused game was left mid-state and round 2's `setBanker` threw forever —
    // the table never left WAITING.
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });

    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 2,
      10_000,
    );

    // Round 2 deals and settles normally.
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);
    expect(calls).toBe(2);

    // A second round in a row after the recovered one — the fresh-game rebuild in `maybeStartRound`
    // is not a one-shot patch that only covers the round immediately after an abandon.
    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 3,
      10_000,
    );
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);
    expect(calls).toBe(3);

    room.dispose();
  }, 20_000);

  /**
   * The second way the reused-game bug bit: settlement itself can succeed and a LATER step (the
   * jackpot draw) still throw. That left the state machine RESOLVED with `nextRound()` never
   * called, so the next round's `setBanker` threw 'betting is closed' forever. A fresh game per
   * round sidesteps this the same way — round 2 gets a brand-new instance in BETTING regardless of
   * what state round 1's instance was abandoned in.
   */
  it('deals and settles round 2 after round 1 settles but a later step throws', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;

    let settleCalls = 0;
    const realSettle = bank.settleTableHand.bind(bank);
    bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      settleCalls += 1;
      return realSettle(req);
    };

    const room = new SanZhangRoom(
      {
        id: 'san-zhang-bug26-post-settle-throw',
        name: 'Test San Zhang',
        game: 'san-zhang',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    let jackpotCalls = 0;
    const realProcessJackpot = (room as unknown as { processJackpot: (...a: unknown[]) => Promise<void> })
      .processJackpot.bind(room);
    (room as unknown as { processJackpot: (...a: unknown[]) => Promise<void> }).processJackpot = async (
      ...args: unknown[]
    ): Promise<void> => {
      jackpotCalls += 1;
      if (jackpotCalls === 1) throw new Error('jackpot pool unavailable');
      return realProcessJackpot(...args);
    };

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });

    // Round 1's settlement went through (money moved) but the jackpot step threw, so the room
    // abandons — WAITING, then it deals round 2 on its own.
    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 2,
      10_000,
    );

    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);

    expect(settleCalls).toBe(2);
    room.dispose();
  }, 15_000);
});
