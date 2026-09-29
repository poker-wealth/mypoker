import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM } from '../../src/live/poker-room';
import { TableHub } from '../../src/live/table-hub';

const BUY_IN = 2_000;
const STARTING = 10_000;

/**
 * BUG-07 (commit 3): `hub.close()` only ever disposed each room's timers — it never released a
 * seat, so every table's stacks stayed locked in FC across a deploy or restart. `hub.drain()`
 * drains every table (a poker room and a base room, the two `LiveRoom` implementations) in
 * parallel before `close()` runs, so one slow or refusing table does not hold up the rest getting
 * their money back before the platform's shutdown grace period runs out.
 */
describe('TableHub.drain — graceful shutdown across every table (BUG-07)', () => {
  it('releases every seated player across a poker room and a base room', async () => {
    const players = new DevPlayers({ startingChips: STARTING });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // poker
    const bob = players.create('Bob').id; // poker
    const carol = players.create('Carol').id; // baccarat

    const releaseCalls: string[] = [];
    const realRelease = bank.release.bind(bank);
    bank.release = (playerAccountId: string, amount: string): Promise<void> => {
      releaseCalls.push(playerAccountId);
      return realRelease(playerAccountId, amount);
    };

    const hub = new TableHub({ directory: players, fc: bank }, () => ({ playerId: 'nobody' }));
    hub.addTable({
      ...DEFAULT_ROOM,
      id: 'hub-drain-poker',
      game: 'texas',
      name: 'Hub Drain Poker',
      autoStartPlayers: 0, // stay WAITING — this test is about drain reaching every table, not a hand
    });
    hub.addTable({
      id: 'hub-drain-baccarat',
      name: 'Hub Drain Baccarat',
      game: 'baccarat',
      minBuyIn: 1_000,
      maxBuyIn: 50_000,
      maxSeats: 6,
      rakeBps: 500,
      tiePayout: 8,
      bettingTimeMs: 50,
      showdownDelayMs: 20,
    });

    const poker = hub.room('hub-drain-poker')!;
    const baccarat = hub.room('hub-drain-baccarat')!;

    await poker.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await poker.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await baccarat.command(carol, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    await hub.drain();

    expect(releaseCalls.sort()).toEqual([alice, bob, carol].sort());
    expect(players.find(alice)!.available).toBe(STARTING);
    expect(players.find(bob)!.available).toBe(STARTING);
    expect(players.find(carol)!.available).toBe(STARTING);

    await hub.close();
  });

  it("a release failure for one table's seat does not stop the other table from draining", async () => {
    const players = new DevPlayers({ startingChips: STARTING });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id; // poker — release refused
    const carol = players.create('Carol').id; // baccarat — must still drain

    const realRelease = bank.release.bind(bank);
    bank.release = (playerAccountId: string, amount: string): Promise<void> => {
      if (playerAccountId === alice) return Promise.reject(new Error('financial-core unreachable'));
      return realRelease(playerAccountId, amount);
    };

    const hub = new TableHub({ directory: players, fc: bank }, () => ({ playerId: 'nobody' }));
    hub.addTable({
      ...DEFAULT_ROOM,
      id: 'hub-drain-poker-2',
      game: 'texas',
      name: 'Hub Drain Poker 2',
      autoStartPlayers: 0,
    });
    hub.addTable({
      id: 'hub-drain-baccarat-2',
      name: 'Hub Drain Baccarat 2',
      game: 'baccarat',
      minBuyIn: 1_000,
      maxBuyIn: 50_000,
      maxSeats: 6,
      rakeBps: 500,
      tiePayout: 8,
      bettingTimeMs: 50,
      showdownDelayMs: 20,
    });

    const poker = hub.room('hub-drain-poker-2')!;
    const baccarat = hub.room('hub-drain-baccarat-2')!;

    await poker.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await baccarat.command(carol, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    await expect(hub.drain()).resolves.toBeUndefined(); // must not throw / reject

    // Carol's table drained fine despite Alice's table failing.
    expect(players.find(carol)!.available).toBe(STARTING);
    // Alice's money is still locked, not lost — PokerRoom.finishClose logs and moves on, same as
    // BaseLiveRoom.drain and close() already do for a refused release.
    expect(players.find(alice)!.available).toBe(STARTING - BUY_IN);

    await hub.close();
  });
});
