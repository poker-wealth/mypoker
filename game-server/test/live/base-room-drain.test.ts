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

const BACCARAT_CFG = {
  game: 'baccarat' as const,
  minBuyIn: 1_000,
  maxBuyIn: 50_000,
  maxSeats: 6,
  rakeBps: 500,
  tiePayout: 8,
  bettingTimeMs: 5_000,
  showdownDelayMs: 20,
};

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

    // D7 (BUG-07 follow-up): drain() now REJECTS when a seat failed to release, so gateway/server.ts
    // can exit 1 instead of a silent 0 — but it still tries every seat first (Bob still gets his
    // chips back below) rather than bailing on the first failure.
    await expect(room.drain()).rejects.toThrow(/1 seat\(s\) unreleased/);

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

/**
 * D2 (BUG-07 follow-up): `draining` flips synchronously the instant `drain()` is called, before the
 * queue even sees it, so new money and new bets are refused immediately rather than racing whatever
 * `drain()`'s own queued release loop is doing.
 */
describe('BaseLiveRoom.drain — refuses new money and new bets while draining (D2)', () => {
  it('refuses sit, topUp, and act once drain() has been called', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const charlie = players.create('Charlie').id;

    const room = new BaccaratRoom(
      { id: 'baccarat-bug07-drain-refuse', name: 'Test Baccarat', ...BACCARAT_CFG },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    const drainPromise = room.drain();

    await expect(room.command(charlie, { kind: 'sit', seat: 1, buyIn: BUY_IN })).rejects.toThrow(
      'this table is closing',
    );
    await expect(room.command(alice, { kind: 'buyIn', amount: 100 })).rejects.toThrow('this table is closing');
    await expect(
      room.command(alice, { kind: 'act', action: { type: 'player', amount: 100 } }),
    ).rejects.toThrow('this table is closing');

    await drainPromise;
    room.dispose();
  });
});

/**
 * D2 (BUG-07 follow-up): the first version of `drain()` released seats immediately, racing an
 * in-flight settlement — `resolveRound`/`settleTableHand` reading or writing a seat the drain loop
 * had already emptied. `drain()` now runs as a queued task, so it only starts once whatever
 * settlement was already in flight has fully finished.
 */
describe('BaseLiveRoom.drain — waits for an in-flight settlement (D2)', () => {
  it('queues behind settleTableHand, then releases each seat exactly once at its settled stack', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // seated first — becomes banker
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    // Fake FC that takes ~200ms to settle — long enough that drain(), called right after the bet
    // that triggers settlement, would resolve well before it if drain() were not queued behind it.
    const realSettle = bank.settleTableHand.bind(bank);
    bank.settleTableHand = async (req): ReturnType<typeof realSettle> => {
      await wait(200);
      return realSettle(req);
    };
    const releaseSpy = jest.spyOn(bank, 'release');

    const room = new BaccaratRoom(
      { id: 'baccarat-bug07-drain-settle-race', name: 'Test Baccarat', ...BACCARAT_CFG },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Bob (bettor) bets — this queues resolveRound() right behind this command, and resolveRound
    // awaits the (now 200ms-delayed) settleTableHand call before touching any seat.
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 200 } });

    let drained = false;
    const drainPromise = room.drain().then(() => {
      drained = true;
    });

    // Comfortably inside the 200ms settlement delay — drain must still be queued behind it.
    await wait(50);
    expect(drained).toBe(false);
    expect(releaseSpy).not.toHaveBeenCalled();

    await drainPromise;
    expect(drained).toBe(true);

    // Exactly one release per seat — no double release from a race between resolveRound's own
    // per-seat writes and drain's release loop.
    expect(releaseSpy).toHaveBeenCalledTimes(2);
    const releasedIds = releaseSpy.mock.calls.map((args) => args[0]).sort();
    expect(releasedIds).toEqual([alice, bob].sort());

    // Each seat was released at its SETTLED stack, not its pre-hand buy-in: the two release amounts
    // sum to exactly what stayed out of the rake sink — conservation the settlement itself defines,
    // regardless of which side won.
    const totalReleased = releaseSpy.mock.calls.reduce((sum, args) => sum + Number(args[1]), 0);
    expect(totalReleased).toBe(2 * BUY_IN - bank.sinkTotal());
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);
});
