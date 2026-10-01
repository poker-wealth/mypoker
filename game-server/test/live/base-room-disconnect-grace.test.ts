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
  disconnectTimers: Map<string, NodeJS.Timeout>;
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

/** Clears whatever grace timer is currently armed for `playerId` so a test can re-arm it at a
 *  short delay in place of waiting out the real internal backoff (30s on a failed release, 5s
 *  while the seat is not yet safe). */
function clearGrace(room: BaccaratRoom, playerId: string): void {
  const internals = room as unknown as RoomInternals;
  const timer = internals.disconnectTimers.get(playerId);
  if (timer) clearTimeout(timer);
  internals.disconnectTimers.delete(playerId);
}

/**
 * BUG-07 follow-up (rework of commit 2, eb23584 rejected by audit): the grace check used to gate
 * on the TABLE's phase — `phase !== 'WAITING' || seat.bet > 0` — rather than on whether THIS seat
 * carried anything live. On a busy table (someone else betting every round) a disconnected seat
 * that never had a chip at risk still saw `phase !== 'WAITING'` on every check, because the next
 * round always started before the grace task ran (a disconnected seat still counts as occupied):
 * 42 hands, still seated, for a player who was never actually owed a wait.
 *
 * Fixed: `seatCommitted(seat)` decides per seat (a live bet, or the bank), and `graceReleaseSafe`
 * only falls back to the table-wide phase for the case that needs it — a sticky flag like
 * `isBanker` that survives between rounds. `releaseDeparted`, called by every room right after
 * `phase = 'WAITING'` and before it deals the next round, frees anyone the timer itself could not
 * get to in time — the fix for the actual race, not just the check.
 */
describe('BaseLiveRoom — disconnect grace is seat-specific, not table-wide (BUG-07)', () => {
  it('releases a disconnected non-bettor within one round even while the table stays busy', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // banker — seated first
    const bob = players.create('Bob').id; // bets, stays connected — keeps the table "busy"
    const carol = players.create('Carol').id; // disconnects, never has a bet in
    const carolBefore = players.find(carol)!.available;

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-busy-table',
        name: 'Test Baccarat',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        tiePayout: 8,
        bettingTimeMs: 30, // rounds cycle fast — the table stays genuinely busy
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await room.command(carol, { kind: 'sit', seat: 2, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 100 } });

    // Carol drops without ever placing a bet — the exact repro the audit gave for eb23584: a
    // disconnected non-bettor at a table that keeps dealing rounds around her.
    markDisconnected(room, carol);
    armGrace(room, carol, 15);

    // Released well within what a "42 hands, still seated" table would need — the old table-wide
    // `phase` gate is what used to keep this seat forever.
    await until(() => !room.snapshotFor(alice).seats.some((s) => s.playerId === carol), 3_000);
    expect(players.find(carol)!.available).toBe(carolBefore);

    room.dispose();
  }, 10_000);

  it('does not release a disconnected bettor mid-round, releases once the round resolves', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // banker
    const bob = players.create('Bob').id; // bets, then drops
    const carol = players.create('Carol').id; // connected filler — keeps the round from
    // auto-resolving the instant Bob bets, so the round is genuinely still open when he drops
    const startingTotal = players.totalChips();

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-committed-grace',
        name: 'Test Baccarat',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        tiePayout: 8,
        // The betting window is armed the instant the round starts (Bob's sit, seat 2 of 2), not
        // from when he later bets — generous here so async overhead from the sits, the `until`
        // poll and the bet itself cannot race it shut before the grace check below has fired.
        bettingTimeMs: 400,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await room.command(carol, { kind: 'sit', seat: 2, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Bob bets, then drops — the bet is what has to gate the release now, not the table's phase.
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 100 } });
    markDisconnected(room, bob);
    armGrace(room, bob, 15);

    await wait(60);
    // Grace has fired (15ms) well before the window closes — still there, still committed.
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === bob)).toBe(true);

    // The round resolves on its own — Bob's bet is live, so it is settled for real (won or lost)
    // exactly as it would be if he had stayed connected, THEN `releaseDeparted` frees him at that
    // round boundary rather than waiting out the timer's own 5s re-arm. Win or lose is random, so
    // this checks conservation rather than an exact balance.
    await until(() => !room.snapshotFor(alice).seats.some((s) => s.playerId === bob), 8_000);
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 10_000);

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

  it('a refused release is retried once the grace check fires again', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const aliceBefore = players.find(alice)!.available;

    const realRelease = bank.release.bind(bank);
    let calls = 0;
    bank.release = (playerAccountId: string, amount: string): Promise<void> => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('financial-core unreachable'));
      return realRelease(playerAccountId, amount);
    };

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-grace-retry',
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

    // Alone — the table stays WAITING, so the "is it safe" half of the check is trivially true and
    // the only thing under test is the retry-on-failure path.
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    markDisconnected(room, alice);
    armGrace(room, alice, 15);

    // First attempt: fc.release refuses. The seat stays — occupied, still Alice's, still holding
    // her stack — exactly what BUG-07 commit 1 (53b7552) already guarantees at the releaseSeat
    // level; this is the grace timer's own reaction to that throw.
    await until(() => calls === 1, 3_000);
    await wait(30); // let the rejected attempt finish settling inside the room's queue
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === alice)).toBe(true);
    expect(players.find(alice)!.available).toBe(aliceBefore - BUY_IN);

    // The real backoff is 30s; simulate it having elapsed by re-arming the same check at a short
    // delay instead — the room's own leaving-seat sweep or a fresh disconnect would do the same.
    clearGrace(room, alice);
    armGrace(room, alice, 15);

    await until(() => !room.snapshotFor(alice).seats.some((s) => s.playerId === alice), 3_000);
    expect(players.find(alice)!.available).toBe(aliceBefore);
    expect(calls).toBe(2);

    room.dispose();
  }, 10_000);
});
