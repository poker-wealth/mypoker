import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';

/**
 * Pausing and closing a table.
 *
 * MONEY-TOUCHING (close). What is pinned is not that the buttons work but that
 * neither can be used to trap or take someone's chips: a paused table still
 * lets players leave with their stacks, and a closed one returns every one of
 * them without ever deciding a live pot.
 */

const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  actionTimeoutMs: 5_000, // long: nothing should time out while a test looks at it
  disconnectGraceMs: 20,
  spectatorDelayMs: 0,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for the table to reach the expected state');
}

function harness(overrides: Partial<PokerRoomConfig> = {}) {
  const players = new DevPlayers({ startingChips: 10_000 });
  const bank = new ChipBank(players);
  const alice = players.create('Alice').id;
  const bob = players.create('Bob').id;
  const room = new PokerRoom(
    { ...FAST, id: 't-host', name: 'Host table', ...overrides } as PokerRoomConfig,
    { directory: players, fc: bank },
  );
  (room.config as { ownerId?: string }).ownerId = alice;
  return { room, players, alice, bob };
}

describe('host pause', () => {
  it('refuses anyone who is not the owner', async () => {
    const h = harness({ autoStartPlayers: 0 });
    await expect(h.room.command(h.bob, { kind: 'pause', paused: true })).rejects.toThrow(
      /only the table creator/i,
    );
    h.room.dispose();
  });

  it('stops the next hand starting, and resuming starts one', async () => {
    const h = harness({ autoStartPlayers: 0 });
    await h.room.command(h.alice, { kind: 'pause', paused: true });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await h.room.command(h.alice, { kind: 'start_game' }).catch(() => undefined);

    // Two seated players with chips would normally deal. Paused, nothing does.
    await wait(120);
    expect(h.room.snapshotFor(h.alice).phase).toBe('WAITING');

    await h.room.command(h.alice, { kind: 'pause', paused: false });
    await until(() => h.room.snapshotFor(h.alice).phase !== 'WAITING');
    h.room.dispose();
  });

  it('lets a player leave WITH THEIR CHIPS while paused', async () => {
    const h = harness({ autoStartPlayers: 0 });
    const before = h.players.find(h.bob)!.available;
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await h.room.command(h.alice, { kind: 'pause', paused: true });

    await h.room.command(h.bob, { kind: 'stand' });

    // A pause that also trapped stacks would be the owner holding other
    // people's money. Every chip back.
    expect(h.players.find(h.bob)!.available).toBe(before);
    h.room.dispose();
  });
});

describe('host close', () => {
  it('refuses anyone who is not the owner', async () => {
    const h = harness({ autoStartPlayers: 0 });
    await expect(h.room.command(h.bob, { kind: 'close_table' })).rejects.toThrow(
      /only the table creator/i,
    );
    h.room.dispose();
  });

  it('returns every seated player their whole stack', async () => {
    const h = harness({ autoStartPlayers: 0 });
    const aliceBefore = h.players.find(h.alice)!.available;
    const bobBefore = h.players.find(h.bob)!.available;

    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 1_500 });

    await h.room.command(h.alice, { kind: 'close_table' });
    await until(() => h.room.snapshotFor(h.alice).seats.length === 0);

    expect(h.players.find(h.alice)!.available).toBe(aliceBefore);
    expect(h.players.find(h.bob)!.available).toBe(bobBefore);
    h.room.dispose();
  });

  it('does NOT close mid-hand — the hand finishes first', async () => {
    const h = harness();
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');

    await h.room.command(h.alice, { kind: 'close_table' });

    // Still seated, still in the hand: the pot belongs to whoever wins it, and
    // closing now would mean voiding it or deciding it without a showdown.
    expect(h.room.snapshotFor(h.alice).seats.length).toBeGreaterThan(0);
    expect(h.room.snapshotFor(h.alice).phase).toBe('IN_HAND');
    h.room.dispose();
  });

  it('is idempotent — closing twice does not double-release a seat', async () => {
    const h = harness({ autoStartPlayers: 0 });
    const before = h.players.find(h.bob)!.available;
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });

    await h.room.command(h.alice, { kind: 'close_table' });
    await h.room.command(h.alice, { kind: 'close_table' });
    await until(() => h.room.snapshotFor(h.alice).seats.length === 0);

    // Exactly one refund. A second would be chips created from nothing.
    expect(h.players.find(h.bob)!.available).toBe(before);
    h.room.dispose();
  });
});
