import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { BaccaratRoom } from '../../src/live/baccarat-room';

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

/** Reach into the protected internals a real disconnect would touch, without waiting on the real
 *  30-second default grace — the mechanism under test is what the timer body DOES, not how long it
 *  waits to fire the first time. */
type RoomInternals = {
  seats: Array<{ playerId: string; connected: boolean; bet: number } | null>;
  armDisconnectGrace(playerId: string, graceMs?: number): void;
};

function markDisconnected(room: BaccaratRoom, playerId: string): void {
  const seat = (room as unknown as RoomInternals).seats.find((s) => s?.playerId === playerId);
  if (!seat) throw new Error(`${playerId} is not seated`);
  seat.connected = false;
}

function armGrace(room: BaccaratRoom, playerId: string, graceMs: number): void {
  (room as unknown as RoomInternals).armDisconnectGrace(playerId, graceMs);
}

/**
 * BUG-07 (commit 2): the disconnect-grace timer used to arm only when `phase === 'WAITING'` at the
 * moment of disconnect, and nothing re-armed it once a round in progress ended. A player who
 * dropped mid-round kept the seat — and the locked chips behind it — forever, because the one path
 * that freed a seat (`join()`'s reconnect) never fires for someone who never comes back.
 *
 * Fixed: the grace timer is now always armed on disconnect, and its body re-arms itself every 5s
 * for as long as the round is live (or this seat has a bet in it) instead of giving up.
 */
describe('BaseLiveRoom — disconnect grace released once the round ends (BUG-07)', () => {
  it('does not release mid-round, releases once the round ends, chips returned', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const bobBefore = players.find(bob)!.available;

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-grace',
        name: 'Test Baccarat',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        tiePayout: 8,
        bettingTimeMs: 50, // nobody bets — the round resolves to WAITING on its own, fast
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Bob drops mid-round, before betting.
    markDisconnected(room, bob);
    armGrace(room, bob, 20);

    await wait(80);
    // Still IN_HAND (or just past it) — the seat must still be there either way, never released
    // while a round Bob was part of was live.
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === bob)).toBe(true);

    // The round resolves on its own (nobody bet) — back to WAITING.
    await until(() => room.snapshotFor(alice).phase === 'WAITING', 5_000);

    // The re-armed 5s check now finds it safe and releases the seat.
    await until(() => !room.snapshotFor(alice).seats.some((s) => s.playerId === bob), 8_000);
    expect(players.find(bob)!.available).toBe(bobBefore);

    room.dispose();
  }, 20_000);

  it('reconnecting during the grace window keeps the seat', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-grace-reconnect',
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

    // Alone: baccarat refuses to deal below two seats, so phase stays WAITING throughout.
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    expect(room.snapshotFor(alice).phase).toBe('WAITING');

    markDisconnected(room, alice);
    armGrace(room, alice, 150);

    await wait(50);
    // Reconnect before the 150ms grace fires — the real join() path, exercising the actual timer
    // clear it relies on.
    const stop = room.join(alice, { sendSnapshot: () => {} });

    await wait(250); // past when the original grace would have fired
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === alice)).toBe(true);

    stop();
    room.dispose();
  }, 10_000);
});
