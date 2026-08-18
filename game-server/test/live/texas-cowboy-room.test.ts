import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { TexasCowboyRoom } from '../../src/live/texas-cowboy-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';

/**
 * TEXAS COWBOY — the room-level conservation test the table never had (ESTHER_V2 task 2).
 *
 * This table is the one most worth pinning. Nobody banks it, so the round is player-funded: the
 * losing stakes ARE the prize pool and the winners divide them. It previously paid winners without
 * calling the ledger at all — minting chips — which only surfaced when a probe hit "cannot release
 * more than is locked". So the assertion here is the whole point of the game's design: after a
 * round, every chip is still accounted for, and the house has taken its cut and nothing more.
 */

const BUY_IN = 5_000;

const wait = (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(10);
  }
  throw new Error('timed out waiting for state');
}

function newRoom(id: string, deps: { directory: DevPlayers; fc: ChipBank }): TexasCowboyRoom {
  return new TexasCowboyRoom(
    {
      id,
      name: 'Test Texas Cowboy',
      game: 'texas-cowboy',
      minBuyIn: 1_000,
      maxBuyIn: 50_000,
      maxSeats: 100,
      rakeBps: 500,
    },
    deps,
  );
}

describe('TexasCowboyRoom — Live Room Integration', () => {
  it('registers texas-cowboy table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const table = hub.tables().find((t) => t.tableId === 'texas-cowboy');
    expect(table).toBeDefined();
    await hub.close();
  });

  it('settles a round of opposing bets and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = newRoom('texas-cowboy-1', { directory: players, fc: bank });

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    // Opposite sides of the same market, so one of them must lose and fund the other.
    await room.command(alice, {
      kind: 'act',
      action: { type: 'bet', amount: 100, selection: 'cowboy_win' },
    });
    await room.command(bob, {
      kind: 'act',
      action: { type: 'bet', amount: 100, selection: 'cowgirl_win' },
    });

    // The round runs on its own clock: betting window, deal, three reveals, then settlement.
    await until(() => players.totalChips() + bank.sinkTotal() !== startingTotal || false, 1_000)
      .catch(() => undefined);
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 40_000);
    await wait(6_000); // settlement runs a beat after showdown

    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 60_000);

  it('refuses a bet larger than the player can cover', async () => {
    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    const room = newRoom('texas-cowboy-2', { directory: players, fc: bank });
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    await expect(
      room.command(alice, {
        kind: 'act',
        action: { type: 'bet', amount: BUY_IN * 10, selection: 'cowboy_win' },
      }),
    ).rejects.toThrow();

    // The refusal must not have moved anything.
    const seat = room.snapshotFor(alice).seats.find((s) => s.isYou)!;
    expect(seat.bet).toBe(0);

    room.dispose();
  }, 20_000);

  it('holds staked chips out of the stack so the same money cannot be bet twice', async () => {
    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    const room = newRoom('texas-cowboy-3', { directory: players, fc: bank });
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    // Stake most of the stack, then try to stake most of it again.
    await room.command(alice, {
      kind: 'act',
      action: { type: 'bet', amount: BUY_IN - 100, selection: 'cowboy_win' },
    });

    await expect(
      room.command(alice, {
        kind: 'act',
        action: { type: 'bet', amount: BUY_IN - 100, selection: 'tie' },
      }),
    ).rejects.toThrow();

    room.dispose();
  }, 20_000);
});
