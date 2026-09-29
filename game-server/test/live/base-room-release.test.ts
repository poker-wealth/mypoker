import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { BaccaratRoom } from '../../src/live/baccarat-room';

const BUY_IN = 2_000;

/**
 * BUG-07 (commit 1): `BaseLiveRoom.releaseSeat` used to null the seat BEFORE awaiting
 * `fc.release`. A release FC refuses — unreachable, a 409 — then lost the seat AND the money in
 * the same moment: the chips stayed locked with nothing at the table pointing back at them, and
 * the chair looked empty and sittable again. Fixed by releasing first, nulling second — the same
 * order `PokerRoom.releaseSeat` already used.
 *
 * A lone seated player is used throughout: baccarat refuses to deal below two players (see
 * `waitingFor`), so the table stays WAITING and `stand()` is exercised in isolation, without a
 * hand or a bet in the way.
 */
describe('BaseLiveRoom.releaseSeat — a refused release keeps the seat (BUG-07)', () => {
  it('a rejected fc.release leaves the seat occupied with its stack, and a later leave retries and succeeds', async () => {
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
        id: 'baccarat-bug07-release',
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
    expect(room.snapshotFor(alice).phase).toBe('WAITING'); // alone — nobody to deal against

    // First leave attempt: FC refuses the release.
    await expect(room.command(alice, { kind: 'stand' })).rejects.toThrow(/unreachable/);

    // The seat must still be there, holding the same stack — not gone, not shorted.
    const stillSeated = room.snapshotFor(alice).seats.find((s) => s.playerId === alice);
    expect(stillSeated).toBeDefined();
    expect(stillSeated!.stack).toBe(BUY_IN);
    expect(players.find(alice)!.available).toBe(aliceBefore - BUY_IN); // still locked, not lost

    // Second attempt: FC accepts. The retry (not a fresh seat) is what clears it.
    await room.command(alice, { kind: 'stand' });
    expect(room.snapshotFor(alice).seats.find((s) => s.playerId === alice)).toBeUndefined();
    expect(players.find(alice)!.available).toBe(aliceBefore);
    expect(calls).toBe(2);

    room.dispose();
  });
});
