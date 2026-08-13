import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { SanZhangRoom } from '../../src/live/san-zhang-room';
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
