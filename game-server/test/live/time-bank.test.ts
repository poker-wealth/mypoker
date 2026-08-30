import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';

/**
 * The time bank, which decides when a hand auto-folds — and therefore who wins
 * the pot.
 *
 * It shipped with no tests at all. Nothing in the suite would have noticed if
 * dipping into the bank for one second had cost the whole minute, or if the
 * turn clock and the reserve clock had both fired and folded a hand twice. A
 * green verify said nothing about any of it.
 *
 * Driven only through commands and snapshots, like the rest of the room tests:
 * that is the security claim, and it is also the only surface a client has.
 */

const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  actionTimeoutMs: 120,
  disconnectGraceMs: 20,
  spectatorDelayMs: 0,
  initialTimeBankMs: 400,
};

const wait = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a condition, not for a duration — a loaded machine runs timers late,
 * and these tests are about behaviour rather than about the clock.
 */
async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for the table');
}

interface Harness {
  room: PokerRoom;
  alice: string;
  bob: string;
}

function harness(overrides: Partial<PokerRoomConfig> = {}): Harness {
  const players = new DevPlayers({ startingChips: 10_000 });
  const bank = new ChipBank(players);
  const alice = players.create('Alice').id;
  const bob = players.create('Bob').id;
  const room = new PokerRoom({ ...FAST, id: 'tb', name: 'Time bank', ...overrides } as PokerRoomConfig, {
    directory: players,
    fc: bank,
  });
  return { room, alice, bob };
}

async function seatBoth(h: Harness): Promise<void> {
  await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
  await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
  await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
}

/** Whoever the room is currently waiting on. */
function toActPlayer(h: Harness): string {
  const view = h.room.snapshotFor(h.alice);
  const seat = view.seats.find((s) => s.index === view.toActSeat);
  if (!seat) throw new Error('nobody is to act');
  return seat.isYou ? h.alice : h.bob;
}

const bankOf = (h: Harness, playerId: string): number =>
  h.room.snapshotFor(playerId).timeBankMs ?? -1;

/** `lastAction` is carried either as a bare string or as a `{ kind }` object. */
const actionKind = (a: unknown): string | null => {
  if (a == null) return null;
  if (typeof a === 'string') return a;
  return (a as { kind?: string }).kind ?? null;
};

describe('time bank — what it costs to use', () => {
  it('is untouched by an ordinary action', async () => {
    const h = harness();
    await seatBoth(h);
    const actor = toActPlayer(h);

    expect(bankOf(h, actor)).toBe(400);
    await h.room.command(actor, { kind: 'act', action: { type: 'call' } });
    // Not merely "still positive" — a decision taken on the turn clock costs
    // exactly nothing.
    expect(bankOf(h, actor)).toBe(400);
    h.room.dispose();
  });

  it('charges only the time actually spent, not the whole bank', async () => {
    const h = harness();
    await seatBoth(h);
    const actor = toActPlayer(h);

    await h.room.command(actor, { kind: 'useTimeBank' });
    expect(h.room.snapshotFor(actor).usingTimeBank).toBe(true);

    await wait(120);
    await h.room.command(actor, { kind: 'act', action: { type: 'call' } });

    const left = bankOf(h, actor);
    // The bug this exists to prevent is `left === 0`: charging the whole bank
    // for a moment's thought teaches players never to touch it, and the feature
    // may as well not ship. Generous bounds either side — the point is that the
    // charge tracks elapsed time, not that the timer is precise.
    expect(left).toBeGreaterThan(150);
    expect(left).toBeLessThan(380);
    h.room.dispose();
  });

  it('does not charge twice when the hand moves on', async () => {
    const h = harness();
    await seatBoth(h);
    const actor = toActPlayer(h);

    await h.room.command(actor, { kind: 'useTimeBank' });
    await wait(80);
    await h.room.command(actor, { kind: 'act', action: { type: 'call' } });
    const afterActing = bankOf(h, actor);

    // Whatever else happens — the opponent acting, a street turning, the queued
    // reserve timer arriving late — the same seconds must not be deducted again.
    await wait(200);
    expect(bankOf(h, actor)).toBe(afterActing);
    h.room.dispose();
  });
});

describe('time bank — the server owns it', () => {
  it('refuses a player who is not to act', async () => {
    const h = harness();
    await seatBoth(h);
    const waiting = toActPlayer(h) === h.alice ? h.bob : h.alice;
    await expect(h.room.command(waiting, { kind: 'useTimeBank' })).rejects.toThrow(/not your turn/);
    h.room.dispose();
  });

  it('refuses a second helping in the same turn', async () => {
    const h = harness();
    await seatBoth(h);
    const actor = toActPlayer(h);
    await h.room.command(actor, { kind: 'useTimeBank' });
    await expect(h.room.command(actor, { kind: 'useTimeBank' })).rejects.toThrow(/already running/);
    h.room.dispose();
  });

  it('refuses when the bank is empty', async () => {
    const h = harness({ initialTimeBankMs: 0 });
    await seatBoth(h);
    const actor = toActPlayer(h);
    await expect(h.room.command(actor, { kind: 'useTimeBank' })).rejects.toThrow(/no time bank/);
    h.room.dispose();
  });
});

describe('time bank — the two clocks', () => {
  it('leaves the bank alone when the turn clock expires and auto is off', async () => {
    const h = harness({ actionTimeoutMs: 60 });
    await seatBoth(h);
    const actor = toActPlayer(h);

    // Default is off on purpose: an unattended player folds rather than burning
    // everyone's minute.
    expect(h.room.snapshotFor(actor).autoTimeBank).toBe(false);
    await until(() => toActPlayerSafe(h) !== actor);
    expect(bankOf(h, actor)).toBe(400);
    h.room.dispose();
  });

  it('spends the bank instead of folding when auto is on', async () => {
    const h = harness({ actionTimeoutMs: 60, initialTimeBankMs: 500 });
    await seatBoth(h);
    const actor = toActPlayer(h);
    await h.room.command(actor, { kind: 'autoTimeBank', on: true });

    // The turn clock runs out — and the seat is still there deciding, not folded.
    await until(() => h.room.snapshotFor(actor).usingTimeBank === true, 2_000);
    expect(toActPlayer(h)).toBe(actor);
    h.room.dispose();
  });

  /**
   * The race Joe named: the turn clock expiring and the reserve clock expiring
   * are two timers over ONE turn, and between them they must produce exactly one
   * fold or check — never two, and never one for the wrong seat.
   *
   * The failure this rules out is a stale turn-clock timer surviving the swap
   * into the reserve and then acting for whoever is to act LATER — which is a
   * player folded on someone else's clock.
   */
  it('yields exactly one terminal action across both clocks', async () => {
    const h = harness({ actionTimeoutMs: 50, initialTimeBankMs: 60 });
    await seatBoth(h);
    const actor = toActPlayer(h);
    const opponent = actor === h.alice ? h.bob : h.alice;
    await h.room.command(actor, { kind: 'autoTimeBank', on: true });

    // Both clocks run out: turn clock at ~50ms, then the whole reserve at ~110ms.
    await until(() => toActPlayerSafe(h) !== actor, 3_000);

    // One action for the seat whose clocks expired...
    const view = h.room.snapshotFor(opponent);
    const timedOut = view.seats.find((s) => !s.isYou);
    expect(['fold', 'check']).toContain(actionKind(timedOut?.lastAction));
    // ...the reserve is spent...
    expect(bankOf(h, actor)).toBe(0);

    // ...and crucially the opponent was NOT acted for by a leftover timer. If
    // the hand is still live they hold their own turn with a full clock; if it
    // ended by fold they simply took the pot.
    if (view.phase === 'IN_HAND') {
      expect(toActPlayer(h)).toBe(opponent);
      expect(bankOf(h, opponent)).toBe(60);
    }
    h.room.dispose();
  });
});

/** `toActPlayer` but tolerant of the hand being over. */
function toActPlayerSafe(h: Harness): string | null {
  const view = h.room.snapshotFor(h.alice);
  if (view.toActSeat === null) return null;
  const seat = view.seats.find((s) => s.index === view.toActSeat);
  if (!seat) return null;
  return seat.isYou ? h.alice : h.bob;
}
