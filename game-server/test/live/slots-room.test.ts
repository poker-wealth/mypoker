import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { SlotsRoom } from '../../src/live/slots-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';

const BUY_IN = 2_000;

describe('SlotsRoom — Live Room Integration', () => {
  it('registers slots table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const slotsTable = hub.tables().find((t) => t.tableId === 'slots');
    expect(slotsTable).toBeDefined();
    expect(slotsTable?.variant).toBe('Slots');
    await hub.close();
  });

  it('seats a player, spins slot, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    const room = new SlotsRoom(
      {
        id: 'slots-1',
        name: 'Test Slots',
        game: 'slots',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        commissionBps: 500,
      },
      { directory: players, fc: bank },
    );
    const startingTotal = players.totalChips();

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    // Spin slots
    await room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } });

    const snap = room.snapshotFor(alice);
    expect(snap.handNumber).toBe(1);

    // Verify total chip conservation across the entire ledger and bank sinks
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  });
});
