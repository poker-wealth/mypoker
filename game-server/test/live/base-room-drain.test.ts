import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { BaccaratRoom } from '../../src/live/baccarat-room';

const BUY_IN = 2_000;

/**
 * BUG-07 (commit 3): graceful shutdown. `dispose()` only ever stopped timers — it never released a
 * seat, so every seated stack stayed locked in FC across a deploy or restart with nobody at the
 * table anymore. `drain()` gives every occupied seat's stack back through the ordinary
 * `releaseSeat` path before the room disposes, one seat at a time so one seat's FC failure does not
 * strand the rest.
 */
describe('BaseLiveRoom.drain — graceful shutdown returns every seated stack (BUG-07)', () => {
  it('releases every occupied seat and returns the chips to each wallet', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const aliceBefore = players.find(alice)!.available;
    const bobBefore = players.find(bob)!.available;

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-drain',
        name: 'Test Baccarat',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        tiePayout: 8,
        bettingTimeMs: 50, // short: an unresolved betting timer must not outlive drain()/dispose()
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await room.drain();

    expect(room.snapshotFor(alice).seats.some((s) => s.playerId)).toBe(false);
    expect(players.find(alice)!.available).toBe(aliceBefore);
    expect(players.find(bob)!.available).toBe(bobBefore);

    room.dispose();
  });

  it("a release failure for one seat doesn't stop the others from draining", async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const aliceBefore = players.find(alice)!.available;
    const bobBefore = players.find(bob)!.available;

    const realRelease = bank.release.bind(bank);
    bank.release = (playerAccountId: string, amount: string): Promise<void> => {
      if (playerAccountId === alice) return Promise.reject(new Error('financial-core unreachable'));
      return realRelease(playerAccountId, amount);
    };

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-drain-partial',
        name: 'Test Baccarat',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        tiePayout: 8,
        bettingTimeMs: 50,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await room.drain(); // must not throw even though Alice's release is refused

    // Bob still gets his chips back — Alice's failure did not strand him.
    expect(room.snapshotFor(bob).seats.find((s) => s.playerId === bob)).toBeUndefined();
    expect(players.find(bob)!.available).toBe(bobBefore);

    // Alice's release failed, so (BUG-07 commit 1's ordering) her seat stays exactly as it was —
    // still occupied, still holding its stack — rather than the chair going empty with her chips
    // stuck nowhere. Nothing lost, nothing invented.
    const aliceSeat = room.snapshotFor(alice).seats.find((s) => s.playerId === alice);
    expect(aliceSeat).toBeDefined();
    expect(aliceSeat!.stack).toBe(BUY_IN);
    expect(players.find(alice)!.available).toBe(aliceBefore - BUY_IN);

    room.dispose();
  });
});
