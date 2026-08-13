import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { LotteryRoom } from '../../src/live/lottery-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';

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
});
