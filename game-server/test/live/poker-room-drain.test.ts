import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';

// actionTimeoutMs is deliberately left at DEFAULT_ROOM's real 20_000 (the production action clock,
// D1) — the whole point of this suite is that drain() does not wait for it, or for time-bank on top
// of it. Only the deal/showdown breathers are shortened so hands start and finish quickly in tests.
const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  disconnectGraceMs: 20,
  spectatorDelayMs: 0,
};

const BUY_IN = 2_000;
const STARTING = 10_000;

const wait = (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for state');
}

/**
 * BUG-07 follow-up (D1): the auditor rejected the first version of `PokerRoom.drain`, which shared
 * `close()`'s machinery and WAITED for a mid-hand table to reach its own showdown. That doesn't fit
 * inside a hard shutdown window — a hand can legitimately run past a 25s hard exit (a 20s action
 * clock plus up to 60s of time bank per player) — so `drain()` now VOIDS a hand in progress instead:
 * no settlement is issued, and every seat is released at its pre-hand stack, which is safe because
 * `seat.stack` in this room is never written while a hand is in progress (see the MONEY CHECK
 * comment on `abandonHand` and the doc comment on `drain()` itself).
 */
describe('PokerRoom.drain — voids a live hand rather than waiting it out (BUG-07 follow-up — D1)', () => {
  it('resolves in under 1s despite a 20s action clock, issues no settlement, and returns pre-hand stacks', async () => {
    const players = new DevPlayers({ startingChips: STARTING });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const settleSpy = jest.spyOn(bank, 'settleTableHand');

    const room = new PokerRoom(
      { ...FAST, id: 't-drain', name: 'Drain table' } as PokerRoomConfig,
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    const startedAt = Date.now();
    await room.drain();
    const elapsedMs = Date.now() - startedAt;

    // The old, waiting drain() could not have returned this fast with a 20s action clock still
    // running — this is the D1 behavior change made observable.
    expect(elapsedMs).toBeLessThan(1_000);
    expect(settleSpy).not.toHaveBeenCalled();

    // Every seat released — nobody left at the table.
    const finalSeats = room.snapshotFor(alice).seats.filter((s) => s.playerId);
    expect(finalSeats.length).toBe(0);

    // Pre-hand figures came back exactly — nothing was settled, so nothing but the original buy-in
    // could have come back.
    expect(players.find(alice)!.available).toBe(STARTING);
    expect(players.find(bob)!.available).toBe(STARTING);

    // Conservation: no rake taken (no settlement ever ran), no chip created or destroyed.
    expect(bank.sinkTotal()).toBe(0);
    expect(players.totalChips() + bank.sinkTotal()).toBe(2 * STARTING);

    room.dispose();
  }, 10_000);

  it('a table with nobody seated drains immediately', async () => {
    const players = new DevPlayers({ startingChips: STARTING });
    const bank = new ChipBank(players);
    const room = new PokerRoom(
      { ...FAST, id: 't-drain-empty', name: 'Empty drain table' } as PokerRoomConfig,
      { directory: players, fc: bank },
    );

    await room.drain();
    expect(room.snapshotFor('nobody').seats.filter((s) => s.playerId).length).toBe(0);
    room.dispose();
  });

  it('refuses sit and buyIn once drain() has been called (D3)', async () => {
    const players = new DevPlayers({ startingChips: STARTING });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const charlie = players.create('Charlie').id;

    const room = new PokerRoom(
      { ...FAST, id: 't-drain-refuse', name: 'Drain refuse table' } as PokerRoomConfig,
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    const drainPromise = room.drain();

    // `closing` flips synchronously inside drain(), before the queue is even touched, so both
    // refusals land even though drain()'s own release loop hasn't run yet.
    await expect(room.command(charlie, { kind: 'sit', seat: 1, buyIn: BUY_IN })).rejects.toThrow(
      'this table is closing',
    );
    await expect(room.command(alice, { kind: 'buyIn', amount: 100 })).rejects.toThrow('this table is closing');

    await drainPromise;
    room.dispose();
  });
});

/**
 * BUG-07 follow-up (DEFECT 2): the auditor rejected the fix for this too. `beginClosing`/
 * `maybeStartHand` fired `finishClose` UN-queued (`void this.finishClose()`), and the old `closed`
 * guard flipped true synchronously, before a single seat had actually been released. So `drain()`'s
 * own queued task, racing an owner's `close_table` already in flight, saw `closed === true` and
 * returned 0 failures immediately — the process could exit while releases were still in flight.
 * `finishClose` is now queued (so `drain()`'s task is naturally ordered behind it, not racing it)
 * and memoized on the RUN itself (`closeRun`), so a second caller joins the SAME release run instead
 * of seeing "already closed" before it has actually finished.
 */
describe('PokerRoom.drain — joins an owner close already in flight (BUG-07 follow-up — DEFECT 2)', () => {
  it('does not resolve before a close_table already in flight finishes releasing, and releases each seat exactly once', async () => {
    const players = new DevPlayers({ startingChips: STARTING });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // owner
    const bob = players.create('Bob').id;

    const realRelease = bank.release.bind(bank);
    let releaseCalls = 0;
    bank.release = async (playerAccountId: string, amount: string): Promise<void> => {
      releaseCalls += 1;
      await wait(200);
      return realRelease(playerAccountId, amount);
    };

    const room = new PokerRoom(
      {
        ...FAST,
        id: 't-drain-close-race',
        name: 'Drain close race',
        ownerId: alice,
        autoStartPlayers: 0, // stay WAITING — this test is about the close/drain race, not a hand
      } as PokerRoomConfig,
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    // Owner closes — queues finishClose, whose releases are now delayed 200ms each.
    await room.command(alice, { kind: 'close_table' });

    // drain() called immediately after: it must JOIN the close already queued, not see `closed`
    // early and resolve as if every seat were already gone.
    let drained = false;
    const drainPromise = room.drain().then(() => {
      drained = true;
    });

    await wait(50); // comfortably inside the 200ms release delay
    expect(drained).toBe(false);

    await drainPromise;
    expect(drained).toBe(true);

    // Exactly one release per seat — the two callers joined the SAME run rather than each releasing
    // independently.
    expect(releaseCalls).toBe(2);
    expect(players.find(alice)!.available).toBe(STARTING);
    expect(players.find(bob)!.available).toBe(STARTING);

    room.dispose();
  }, 10_000);

  it('rejects with the failure count when the in-flight close has a refused release', async () => {
    const players = new DevPlayers({ startingChips: STARTING });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // owner — release refused
    const bob = players.create('Bob').id;

    const realRelease = bank.release.bind(bank);
    bank.release = async (playerAccountId: string, amount: string): Promise<void> => {
      await wait(50);
      if (playerAccountId === alice) throw new Error('financial-core unreachable');
      return realRelease(playerAccountId, amount);
    };

    const room = new PokerRoom(
      {
        ...FAST,
        id: 't-drain-close-race-fail',
        name: 'Drain close race fail',
        ownerId: alice,
        autoStartPlayers: 0,
      } as PokerRoomConfig,
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await room.command(alice, { kind: 'close_table' });

    await expect(room.drain()).rejects.toThrow(/1 seat\(s\) unreleased/);

    // Bob's release still succeeded — one seat's failure doesn't strand the other.
    expect(players.find(bob)!.available).toBe(STARTING);
    // Alice's money is still locked, not lost.
    expect(players.find(alice)!.available).toBe(STARTING - BUY_IN);

    room.dispose();
  }, 10_000);
});
