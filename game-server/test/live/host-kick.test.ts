import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';

/**
 * The owner removing a player.
 *
 * MONEY-TOUCHING. A kick takes someone off a table with chips in front of them,
 * so what is pinned here is not that the feature "works" but that it cannot be
 * used to take money: the stack comes back, and a live hand is never folded by
 * someone other than its owner.
 */

const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  actionTimeoutMs: 5_000, // long: no hand should time out while a test inspects it
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
  const carol = players.create('Carol').id;
  const room = new PokerRoom(
    { ...FAST, id: 't-kick', name: 'Kick table', ...overrides } as PokerRoomConfig,
    { directory: players, fc: bank },
  );
  // The route writes ownerId from the verified token; the harness plays it.
  (room.config as { ownerId?: string }).ownerId = alice;
  return { room, players, alice, bob, carol };
}

describe('host kick', () => {
  it('refuses anyone who is not the owner', async () => {
    const h = harness({ autoStartPlayers: 0 });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });

    // Bob is not the owner and must not be able to remove Alice.
    await expect(h.room.command(h.bob, { kind: 'kick', targetId: h.alice })).rejects.toThrow(
      /only the table creator/i,
    );
    expect(h.room.snapshotFor(h.alice).seats.some((s) => s.index === 0)).toBe(true);
    h.room.dispose();
  });

  it('returns the kicked player their whole stack', async () => {
    const h = harness({ autoStartPlayers: 0 });
    const before = h.players.find(h.bob)!.available;

    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    expect(h.players.find(h.bob)!.available).toBe(before - 2_000);

    await h.room.command(h.alice, { kind: 'kick', targetId: h.bob });

    // Every chip back. Not "about right" — the same number that left.
    expect(h.players.find(h.bob)!.available).toBe(before);
    expect(h.room.snapshotFor(h.alice).seats.some((s) => s.index === 1)).toBe(false);
    h.room.dispose();
  });

  it('does NOT fold a live hand — the kick waits for the hand to end', async () => {
    const h = harness();
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');

    const handNumber = h.room.snapshotFor(h.alice).handNumber;
    await h.room.command(h.alice, { kind: 'kick', targetId: h.bob });

    // Still seated, still holding the hand he paid into. An owner must not be
    // able to fold a player who may be holding the best hand.
    const seat = h.room.snapshotFor(h.alice).seats.find((s) => s.index === 1);
    expect(seat).toBeDefined();
    expect(h.room.snapshotFor(h.alice).handNumber).toBe(handNumber);
    h.room.dispose();
  });

  it('refuses a target who is not seated', async () => {
    const h = harness({ autoStartPlayers: 0 });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await expect(h.room.command(h.alice, { kind: 'kick', targetId: h.carol })).rejects.toThrow();
    h.room.dispose();
  });

  it('refuses the owner kicking themselves', async () => {
    const h = harness({ autoStartPlayers: 0 });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await expect(h.room.command(h.alice, { kind: 'kick', targetId: h.alice })).rejects.toThrow(
      /stand up/i,
    );
    h.room.dispose();
  });
});
