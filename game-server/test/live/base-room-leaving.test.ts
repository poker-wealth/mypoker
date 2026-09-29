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
    const internals = room as unknown as { seats: Array<{ leaving?: boolean } | null> };
    internals.seats[0]!.leaving = true;

    await room.command(carol, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(carol).phase === 'IN_HAND');

    const banker = room.snapshotFor(carol).seats.find((s) => s.isDealer);
    expect(banker?.playerId).toBe(carol);

    room.dispose();
  });
});
