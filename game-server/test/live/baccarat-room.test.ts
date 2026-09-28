import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { BaccaratRoom } from '../../src/live/baccarat-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type { SettlementFailureReport, TableSettlementRequest } from '../../src/core/financial-core-client';

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

describe('BaccaratRoom — Live Room Integration', () => {
  it('registers baccarat table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const baccaratTable = hub.tables().find((t) => t.tableId === 'baccarat');
    expect(baccaratTable).toBeDefined();
    expect(baccaratTable?.variant).toBe('Baccarat');
    await hub.close();
  });

  it('seats two players, resolves hand, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new BaccaratRoom(
      {
        id: 'baccarat-1',
        name: 'Test Baccarat',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        tiePayout: 8,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Bob (bettor) bets on Player
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 200 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN');

    const snap = room.snapshotFor(alice);
    expect(snap.phase).toBe('SHOWDOWN');
    /**
     * The hands travel in `gameState`, one per side.
     *
     * This used to read `board.length > 0`, back when both hands were flattened into that array
     * with a '|' between them — which the felt then drew as a card face reading "|". Asserting them
     * apart is also a better check: it catches one side arriving empty, which the flat array could
     * not distinguish.
     */
    const round = snap.gameState as {
      playerCards: string[];
      bankerCards: string[];
      outcome: string | null;
    };
    expect(round.playerCards.length).toBeGreaterThan(0);
    expect(round.bankerCards.length).toBeGreaterThan(0);
    expect(round.outcome).not.toBeNull();

    // Verify ledger-level money conservation including rake sink
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);
});

/**
 * BUG-11: `resolveRound` called `game.start()` (which settles via FC) with no try/catch. A rejected
 * settlement — the ledger unreachable, a 409 — left the table stuck IN_HAND forever: nothing resets
 * `phase`, and a seat's `stack` mirror is only written by the net-delta loop AFTER `game.start()`
 * resolves, so a throw from it means no stack moved either. Mirrors the niu-niu-room recovery and
 * PokerRoom's own BUG-03 fix: `abandonRound` puts the table back to WAITING and reports the failure,
 * and the table deals again on its own rather than sitting dead.
 */
describe('BaccaratRoom — settlement failure recovery (BUG-11)', () => {
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

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug11',
        name: 'Test Baccarat',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        tiePayout: 8,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    const before = new Map(room.snapshotFor(alice).seats.map((s) => [s.playerId, s.stack]));
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 200 } });

    await until(() => room.snapshotFor(alice).phase === 'WAITING');
    for (const seat of room.snapshotFor(alice).seats) {
      expect(seat.stack).toBe(before.get(seat.playerId));
    }
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]![0]).toMatchObject({
      tableId: 'baccarat-bug11',
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
