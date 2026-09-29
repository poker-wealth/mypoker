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

/**
 * BUG-07 follow-up, D6: a leaving player is never dealt in, banked, or bet for.
 *
 * `seat.leaving` is set BEFORE every `releaseSeat` call (`stand()`, the grace path, `drain()`) and
 * — unlike `connected` — stays set even if the release fails and even if the player is still very
 * much connected: `stand()` is the case that matters most here, because a connected player whose
 * release FC refuses is otherwise indistinguishable from anyone else still seated, and would
 * otherwise go on betting, banking, and getting dealt in on a chair it already tried to give up.
 */
describe('BaseLiveRoom — a leaving seat is never dealt in, banked, or bet for (BUG-07)', () => {
  it('a refused release on stand marks the seat leaving: bets are refused, and a later stand retries and succeeds', async () => {
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
        id: 'baccarat-bug07-leaving-stand',
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

    // Alone — baccarat refuses to deal below two seats, so phase stays WAITING and `stand()` is
    // exercised in isolation, the same way base-room-release.test.ts does for BUG-07 commit 1.
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    await expect(room.command(alice, { kind: 'stand' })).rejects.toThrow(/unreachable/);
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === alice)).toBe(true);

    // Refused a fresh bet while leaving — the base dispatcher's guard, not baccarat's own
    // "betting is closed" (phase is WAITING here anyway, so that one would fire too, but the
    // message proves it is the leaving check that catches it).
    await expect(
      room.command(alice, { kind: 'act', action: { type: 'player', amount: 50 } }),
    ).rejects.toThrow(/leaving/);

    // The retry (a later stand, not a fresh seat) is what actually clears it.
    await room.command(alice, { kind: 'stand' });
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === alice)).toBe(false);
    expect(players.find(alice)!.available).toBe(aliceBefore);
    expect(calls).toBe(2);

    room.dispose();
  });

  it('the banker cannot stand mid-round', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // seated first — the banker
    const bob = players.create('Bob').id;

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-banker-stand',
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

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');
    expect(room.snapshotFor(alice).seats.find((s) => s.playerId === alice)?.isDealer).toBe(true);

    await expect(room.command(alice, { kind: 'stand' })).rejects.toThrow(/banker/);
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === alice)).toBe(true);

    room.dispose();
  });

  it('a leaving seat is excluded from the next banker pick', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const bob = players.create('Bob').id;
    const carol = players.create('Carol').id;

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-leaving-banker',
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

    // Bob sits alone first (occupied < 2, no deal yet) and is marked `leaving` directly — the
    // state a stuck failed release would leave him in — before Carol's sit brings the table to
    // two and triggers the deal. Bob, seated first, would otherwise be the banker by default.
    await room.command(bob, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    const internals = room as unknown as {
      seats: Array<{ leaving?: 'stand' | 'disconnect' | 'drain' } | null>;
    };
    internals.seats[0]!.leaving = 'stand';

    await room.command(carol, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(carol).phase === 'IN_HAND');

    const banker = room.snapshotFor(carol).seats.find((s) => s.isDealer);
    expect(banker?.playerId).toBe(carol);

    room.dispose();
  });

  /**
   * F1 (audit fix): `retryLeavingSeats` used to release every `leaving` seat unconditionally, on
   * its own 30s clock, independent of any round boundary. A disconnected BANKER whose grace fires
   * mid-round tags them `leaving` well before it is safe to actually let go of the chair — the
   * grace timer itself correctly waits (re-arms), but the sweep did not ask the same question and
   * would release the banker out from under a round still in progress: their chips gone to the
   * wallet, the bank silently passed to whoever `releaseSeat`'s own reassignment picks next, while
   * every other seat's bet was exposure-checked against the banker that just vanished.
   */
  it('the 30s leaving-seat sweep does not release a mid-round banker; the round boundary does once safe', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // seated first — the banker
    const bob = players.create('Bob').id;
    const carol = players.create('Carol').id; // connected filler — a lone Bob betting would
    // close betting the instant he bets (the only non-banker), resolving the round before this
    // test ever gets to check anything; Carol staying unbet keeps IN_HAND genuinely open.
    const startingTotal = players.totalChips();

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-retry-safety',
        name: 'Test Baccarat',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        tiePayout: 8,
        bettingTimeMs: 300,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await room.command(carol, { kind: 'sit', seat: 2, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 100 } });

    const internals = room as unknown as {
      seats: Array<{ playerId: string; connected: boolean } | null>;
      armDisconnectGrace(playerId: string, graceMs?: number): void;
      retryLeavingSeats(): Promise<void>;
    };
    const seat = internals.seats.find((s) => s?.playerId === alice);
    if (!seat) throw new Error('alice is not seated');
    seat.connected = false;
    internals.armDisconnectGrace(alice, 15);

    await wait(60); // grace has fired — Alice is now `leaving`, but still IN_HAND, still the bank.
    expect(room.snapshotFor(bob).seats.some((s) => s.playerId === alice)).toBe(true);

    // The 30s sweep firing mid-round must NOT release her — this is F1.
    await internals.retryLeavingSeats();
    const midRound = room.snapshotFor(bob).seats.find((s) => s.playerId === alice);
    expect(midRound).toBeDefined();
    expect(midRound!.isDealer).toBe(true);

    // Once the round actually resolves, `releaseDeparted` frees her at the boundary, same as any
    // other disconnected, committed seat.
    await until(() => !room.snapshotFor(bob).seats.some((s) => s.playerId === alice), 8_000);
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);

  /**
   * F2 (audit fix): a `leaving` tag the grace timer set (not the player asking) used to survive a
   * reconnect forever — every future bet refused (a real deadlock for Dou Di Zhu, which cannot
   * skip a turn), and the seat still eligible to be released later by `retryLeavingSeats` or
   * `releaseDeparted` despite the player being back. A `'disconnect'`-tagged seat now clears on
   * reconnect; `'stand'`/`'drain'` — the player, or the room, actually asking to leave — stay sticky.
   */
  it('reconnecting clears a disconnect-origin leaving tag: the seat is kept, and a later bet is accepted', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // banker
    const bob = players.create('Bob').id;
    const carol = players.create('Carol').id; // connected filler — see the retry-safety test above

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug07-reconnect-clears',
        name: 'Test Baccarat',
        game: 'baccarat',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        tiePayout: 8,
        bettingTimeMs: 200,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await room.command(carol, { kind: 'sit', seat: 2, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Bob bets, then drops — grace fires while he is still committed, tagging him 'disconnect'.
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 100 } });
    const internals = room as unknown as {
      seats: Array<{ playerId: string; connected: boolean; leaving?: string } | null>;
      armDisconnectGrace(playerId: string, graceMs?: number): void;
    };
    const seat = internals.seats.find((s) => s?.playerId === bob);
    if (!seat) throw new Error('bob is not seated');
    seat.connected = false;
    internals.armDisconnectGrace(bob, 15);

    await wait(40);
    expect(seat.leaving).toBe('disconnect');

    // Reconnects before the round resolves — the real join() path.
    const stop = room.join(bob, { sendSnapshot: () => {} });
    expect(seat.leaving).toBeUndefined();

    // The round resolves, and the next one deals — nothing here should have tried to release Bob
    // out from under his own seat now that he is back.
    await until(() => room.snapshotFor(alice).handNumber >= 2, 8_000);
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === bob)).toBe(true);

    // Refused-while-leaving no longer applies — a fresh bet in the new round is accepted.
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 50 } });
    expect(room.snapshotFor(alice).seats.find((s) => s.playerId === bob)?.bet).toBe(50);

    stop();
    room.dispose();
  }, 15_000);

  /**
   * F7 / BUG-21 (audit fix): the broadened live-bet guard in `stand()` must not over-block a
   * genuinely uncommitted seat mid-round — a non-bettor at a busy baccarat table is not the banker
   * and carries no bet, so `graceReleaseSafe` is true for them even while the table is IN_HAND, and
   * `stand()` must still let them go immediately, no different from before this fix.
   */
  it('a non-bettor can still stand mid-round', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // banker
    const bob = players.create('Bob').id; // bets, keeps the round open
    const carol = players.create('Carol').id; // never bets, stands mid-round
    const carolBefore = players.find(carol)!.available;

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug21-nonbettor-stand',
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

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await room.command(carol, { kind: 'sit', seat: 2, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 100 } });

    await room.command(carol, { kind: 'stand' });
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === carol)).toBe(false);
    expect(players.find(carol)!.available).toBe(carolBefore);

    room.dispose();
  }, 10_000);
});
