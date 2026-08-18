import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { RedPacketRoom } from '../../src/live/red-packet-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';

/**
 * RED PACKET — the room-level conservation test the table never had (ESTHER_V2 task 2).
 *
 * The engine's own tests check the grid. This checks the thing that actually matters once money is
 * involved: after a real round on a real room, every chip is still somewhere. Losers pay exactly
 * what winners are paid plus the rake, and the table is not left holding anything.
 */

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

describe('RedPacketRoom — Live Room Integration', () => {
  it('registers red-packet table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const table = hub.tables().find((t) => t.tableId === 'red-packet');
    expect(table).toBeDefined();
    expect(table?.variant).toBe('Red Packet');
    await hub.close();
  });

  it('seats two players, resolves a round, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new RedPacketRoom(
      {
        id: 'red-packet-1',
        name: 'Test Red Packet',
        game: 'red-packet',
        size: 25,
        mineCount: 5,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 8,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Seat 0 banks the round; the other seat claims a packet.
    await room.command(bob, { kind: 'act', action: { type: '7', amount: 100 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);

    // Every chip accounted for: what the players hold, plus what the house took.
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);

  it('leaves nothing behind over several rounds', async () => {
    // One round balancing can hide a leak that only shows when reservations carry over.
    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new ChipBank(players);
    const ids = [players.create('A').id, players.create('B').id, players.create('C').id];
    const startingTotal = players.totalChips();

    const room = new RedPacketRoom(
      {
        id: 'red-packet-2',
        name: 'Test Red Packet',
        game: 'red-packet',
        size: 25,
        mineCount: 5,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 8,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    for (const [i, id] of ids.entries()) {
      await room.command(id, { kind: 'sit', seat: i, buyIn: BUY_IN });
    }

    // Tracked by hand number, not by phase: the room passes through WAITING between rounds too
    // quickly to catch, so waiting to observe that phase times out even though the table is fine.
    for (let round = 0; round < 3; round++) {
      const target = round + 1;
      await until(() => {
        const s = room.snapshotFor(ids[0]!);
        return s.handNumber === target && s.phase === 'IN_HAND';
      }, 10_000);

      const banker = room.snapshotFor(ids[0]!).seats.find((s) => s.isDealer)?.playerId;
      for (const [i, id] of ids.entries()) {
        if (id === banker) continue;
        await room.command(id, { kind: 'act', action: { type: String(i + 3), amount: 100 } });
      }

      await until(() => room.snapshotFor(ids[0]!).phase === 'SHOWDOWN', 10_000);
      expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);
    }

    room.dispose();
  }, 30_000);
});
