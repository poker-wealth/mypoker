import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';
import type { TableSnapshot } from '../../src/live/room-state';

/**
 * Two people, two devices, one table. These tests drive the room exactly as the client does —
 * only through commands and snapshots — because that is the whole security claim: nothing a
 * client sends and nothing a client sees can give it an edge.
 */

const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  actionTimeoutMs: 80,
  disconnectGraceMs: 20,
  // Tests watch through unseated viewers; a real spectator lag would just slow them down.
  spectatorDelayMs: 0,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a condition rather than for a duration. The room is timer-driven and a loaded machine
 * runs timers late, so polling keeps these tests about behaviour instead of about the clock.
 */
async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for the table to reach the expected state');
}

interface Harness {
  room: PokerRoom;
  players: DevPlayers;
  bank: ChipBank;
  alice: string;
  bob: string;
  /** Total chips that existed before anyone sat down. */
  startingTotal: number;
}

function harness(overrides: Partial<PokerRoomConfig> = {}): Harness {
  const players = new DevPlayers({ startingChips: 10_000 });
  const bank = new ChipBank(players);
  const alice = players.create('Alice').id;
  const bob = players.create('Bob').id;
  const room = new PokerRoom({ ...FAST, id: 't1', name: 'Test table', ...overrides }, {
    directory: players,
    fc: bank,
  });
  return { room, players, bank, alice, bob, startingTotal: players.totalChips() };
}

/** Play the hand out with the cheapest legal action, as a bored player would. */
async function playToShowdown(h: Harness, seatOf: Record<number, string>): Promise<void> {
  for (let guard = 0; guard < 200; guard++) {
    const view = h.room.snapshotFor(h.alice);
    if (view.phase !== 'IN_HAND' || view.toActSeat === null) return;
    const playerId = seatOf[view.toActSeat]!;
    const legal = h.room.snapshotFor(playerId).legal!;
    await h.room.command(playerId, {
      kind: 'act',
      action: legal.canCheck ? { type: 'check' } : { type: 'call' },
    });
  }
  throw new Error('hand did not finish');
}

/** Sit both players down and wait for the cards to come out. */
async function seatBoth(h: Harness, seatA: number, seatB: number): Promise<void> {
  await h.room.command(h.alice, { kind: 'sit', seat: seatA, buyIn: 2_000 });
  await h.room.command(h.bob, { kind: 'sit', seat: seatB, buyIn: 2_000 });
  await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
}

describe('PokerRoom — a table real people sit at', () => {
  it('deals as soon as two players have bought in', async () => {
    const h = harness();
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    expect(h.room.snapshotFor(h.alice).phase).toBe('WAITING'); // one player is not a game

    await h.room.command(h.bob, { kind: 'sit', seat: 3, buyIn: 2_000 });
    expect(h.room.snapshotFor(h.alice).phase).toBe('DEALING');

    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
    const view = h.room.snapshotFor(h.alice);
    expect(view.seats).toHaveLength(2);
    expect(view.pot + view.seats.reduce((sum, s) => sum + s.bet, 0)).toBe(30); // blinds 10 + 20
    h.room.dispose();
  });

  it('never puts an opponent’s hole cards in your snapshot', async () => {
    const h = harness();
    await seatBoth(h, 0, 1);

    const view = h.room.snapshotFor(h.alice);
    const mine = view.seats.find((s) => s.isYou)!;
    const theirs = view.seats.find((s) => !s.isYou)!;

    expect(mine.cards.every((c) => typeof c === 'string')).toBe(true);
    expect(theirs.cards).toEqual([null, null]); // face-down, and that is all the client is told

    // Bob's actual cards appear nowhere Alice can read them. Checked against the fields that carry
    // cards rather than by searching the whole payload — a card like '9c' is valid hex and collides
    // with the fairness hashes often enough to fail at random.
    const bobsCards = h.room.snapshotFor(h.bob).seats.find((s) => s.isYou)!.cards;
    const visibleToAlice = [...view.board, ...view.seats.filter((s) => !s.isYou).flatMap((s) => s.cards)];
    for (const card of bobsCards) expect(visibleToAlice).not.toContain(card);
    h.room.dispose();
  });

  it('only the player to act is given legal actions', async () => {
    const h = harness();
    await seatBoth(h, 0, 1);

    const seatOf: Record<number, string> = { 0: h.alice, 1: h.bob };
    const toAct = h.room.snapshotFor(h.alice).toActSeat!;
    const waiting = toAct === 0 ? h.bob : h.alice;

    expect(h.room.snapshotFor(seatOf[toAct]!).legal).not.toBeNull();
    expect(h.room.snapshotFor(waiting).legal).toBeNull();
    await expect(h.room.command(waiting, { kind: 'act', action: { type: 'fold' } })).rejects.toThrow(
      /not your turn/,
    );
    h.room.dispose();
  });

  it('plays a full hand and conserves every chip', async () => {
    const h = harness();
    await seatBoth(h, 0, 2);
    await playToShowdown(h, { 0: h.alice, 2: h.bob });

    const view = h.room.snapshotFor(h.alice);
    expect(view.phase).toBe('SHOWDOWN');
    expect(view.message).toMatch(/wins/);
    expect(view.winners.length).toBeGreaterThan(0);
    expect(view.board).toHaveLength(5);
    // Both hands are face-up at showdown.
    for (const seat of view.seats) expect(seat.cards.every((c) => typeof c === 'string')).toBe(true);
    // The pot went somewhere real: players + house sinks still hold exactly what we started with.
    expect(h.players.totalChips() + h.bank.sinkTotal()).toBe(h.startingTotal);
    h.room.dispose();
  });

  it('rolls into the next hand and moves the button', async () => {
    const h = harness();
    await seatBoth(h, 0, 2);

    const firstButton = h.room.snapshotFor(h.alice).seats.find((s) => s.isDealer)!.index;
    await playToShowdown(h, { 0: h.alice, 2: h.bob });
    await until(() => h.room.snapshotFor(h.alice).handNumber === 2);

    const next = h.room.snapshotFor(h.alice);
    expect(next.seats.find((s) => s.isDealer)!.index).not.toBe(firstButton);
    h.room.dispose();
  });

  it('acts for a player whose clock runs out', async () => {
    const h = harness();
    await seatBoth(h, 0, 1);

    const stalledSeat = h.room.snapshotFor(h.alice).toActSeat!;
    // Nobody acts. The clock has to act for them, or the hand ends outright.
    await until(() => {
      const now = h.room.snapshotFor(h.alice);
      return now.toActSeat === null || now.toActSeat !== stalledSeat;
    });

    const after = h.room.snapshotFor(h.alice);
    expect(after.toActSeat === null || after.toActSeat !== stalledSeat).toBe(true);
    h.room.dispose();
  });

  it('returns an abandoned player’s chips instead of locking them forever', async () => {
    const h = harness({ disconnectGraceMs: 5 });
    const stopWatching = h.room.join(h.alice, { sendSnapshot: () => {}, sendEvent: () => {} });
    await seatBoth(h, 0, 1);

    stopWatching(); // Alice's phone drops off mid-hand
    await playToShowdown(h, { 0: h.alice, 1: h.bob });
    // Grace expires and she is sat out; the abandon timer then frees the chair.
    await until(() => h.room.snapshotFor(h.alice).yourSeat === null);

    expect(h.players.locked(h.alice)).toBe(0); // nothing of hers is stranded at the table
    expect(h.players.locked(h.bob)).toBeGreaterThan(0); // Bob is still sitting there
    expect(h.players.totalChips() + h.bank.sinkTotal()).toBe(h.startingTotal);
    h.room.dispose();
  });

  it('gives a player their chips back when they stand up', async () => {
    const h = harness();
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    expect(h.players.available(h.alice)).toBe(8_000);

    await h.room.command(h.alice, { kind: 'stand' });
    expect(h.players.available(h.alice)).toBe(10_000);
    expect(h.room.snapshotFor(h.alice).yourSeat).toBeNull();
    h.room.dispose();
  });

  it('refuses a seat that is taken, and a buy-in you cannot cover', async () => {
    const h = harness();
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });

    await expect(h.room.command(h.bob, { kind: 'sit', seat: 0, buyIn: 2_000 })).rejects.toThrow(/seat taken/);
    await expect(h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 99_000 })).rejects.toThrow(/buy-in must be/);
    expect(h.players.available(h.bob)).toBe(10_000); // nothing was locked by the failed attempts
    h.room.dispose();
  });

  it('pushes a snapshot to every watcher when the table changes', async () => {
    const h = harness();
    const seen: TableSnapshot[] = [];
    const stop = h.room.join(h.bob, { sendSnapshot: (snapshot: TableSnapshot) => { seen.push(snapshot); }, sendEvent: () => {} });

    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    expect(seen.length).toBeGreaterThanOrEqual(2); // initial + the sit
    expect(seen.at(-1)!.seats[0]!.name).toBe('Alice');

    stop();
    const countAfterLeaving = seen.length;
    await h.room.command(h.alice, { kind: 'stand' });
    expect(seen.length).toBe(countAfterLeaving); // unsubscribed means unsubscribed
    h.room.dispose();
  });
});
