import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';

const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  actionTimeoutMs: 200, // short — nobody acts, so the hand ends itself via forced folds/checks
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
 * BUG-07 (commit 3): PokerRoom.drain shares `close`'s own machinery — the table stops dealing and
 * every seat is released once the current hand ends, exactly as `close_table` already did for an
 * owner (see host-pause-close.test.ts: "does NOT close mid-hand — the hand finishes first"). What's
 * new is that `drain()`'s promise does not resolve early: it waits out a hand in progress, and it
 * needs no owner to call it.
 *
 * A hand already in flight is NOT voided or decided early — `close()`'s own doc comment is explicit
 * that doing either would be the owner deciding a pot that is the cards' to decide. So drain()
 * reuses that same wait: the current hand plays out to its own real settlement (win, lose, chop —
 * whatever the cards say), and only THEN does finishClose release every seat, at its now-settled
 * stack. "Pre-hand values" describes a base room, whose bet is held apart from `stack` all round
 * (BUG-07 commit 3's base-room half) — a poker hand has no such shortcut once it is running, because
 * the whole point of NOT voiding it is that it is allowed to actually finish.
 */
describe('PokerRoom.drain — graceful shutdown (BUG-07)', () => {
  it('does not resolve until a mid-hand table finishes, then drains at the settled stacks', async () => {
    const players = new DevPlayers({ startingChips: STARTING });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;

    const room = new PokerRoom(
      { ...FAST, id: 't-drain', name: 'Drain table' } as PokerRoomConfig,
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    let drained = false;
    const drainPromise = room.drain().then(() => {
      drained = true;
    });

    // Well inside the 200ms action timeout — the hand cannot have finished yet.
    await wait(30);
    expect(drained).toBe(false);
    expect(room.snapshotFor(alice).phase).toBe('IN_HAND');
    // Neither seat's chips moved yet — drain() does not touch anything mid-hand, only stops the
    // NEXT one from dealing.
    expect(players.find(alice)!.available).toBe(STARTING - BUY_IN);
    expect(players.find(bob)!.available).toBe(STARTING - BUY_IN);

    // Nobody acts, so the hand plays itself out via forced timeouts and reaches its own end.
    await drainPromise;
    expect(drained).toBe(true);

    // Every seat released — nobody left at the table.
    const finalSeats = room.snapshotFor(alice).seats.filter((s) => s.playerId);
    expect(finalSeats.length).toBe(0);

    // The hand actually settled (nobody voided a live pot) — conservation holds: every chip is
    // either on a wallet or in the rake sink, none created or destroyed.
    expect(players.totalChips() + bank.sinkTotal()).toBe(2 * STARTING);

    room.dispose();
  }, 15_000);

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
});
