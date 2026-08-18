import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DouDiZhuRoom } from '../../src/live/dou-di-zhu-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';

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

describe('DouDiZhuRoom — Live Room Integration', () => {
  it('registers dou-di-zhu table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const ddzTable = hub.tables().find((t) => t.tableId === 'dou-di-zhu');
    expect(ddzTable).toBeDefined();
    expect(ddzTable?.variant).toBe('Dou Di Zhu');
    await hub.close();
  });

  it('seats 3 players, plays out hand, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const p0 = players.create('P0').id;
    const p1 = players.create('P1').id;
    const p2 = players.create('P2').id;
    const startingTotal = players.totalChips();

    const room = new DouDiZhuRoom(
      {
        id: 'dou-di-zhu-1',
        name: 'Test Dou Di Zhu',
        game: 'dou-di-zhu',
        baseStake: 100,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 3,
        rakeBps: 500,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    const noop = { sendSnapshot: () => {} };
    room.join(p0, noop);
    room.join(p1, noop);
    room.join(p2, noop);

    await room.command(p0, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(p1, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await room.command(p2, { kind: 'sit', seat: 2, buyIn: BUY_IN });

    await until(() => room.snapshotFor(p0).phase === 'IN_HAND');

    // Bidding phase: whichever seat is to act bids
    for (let step = 0; step < 5; step++) {
      const snap = room.snapshotFor(p0);
      const toActSeat = snap.toActSeat;
      if (toActSeat === null) break;
      const pid = toActSeat === 0 ? p0 : toActSeat === 1 ? p1 : p2;
      try {
        await room.command(pid, { kind: 'act', action: { type: step === 0 ? 'bid-3' : 'bid-0' } });
      } catch {
        break;
      }
    }

    /**
     * Every seat here is a PERSON, so every move has to come from this test — the room's AI plays
     * bot chairs only. (It used to play seats 1 and 2 for us, which is what let a 30-step loop
     * finish a hand; a table of three humans has to be driven by all three.)
     *
     * Simplest terminating line of play: whoever holds the trick keeps leading their lowest card,
     * the other two always pass. The leader empties their hand and wins.
     */
    const seatPlayer = [p0, p1, p2];
    for (let step = 0; step < 300; step++) {
      const snap = room.snapshotFor(p0);
      if (snap.phase !== 'IN_HAND') break;
      const toActSeat = snap.toActSeat;
      if (toActSeat === null) break;

      const pid = seatPlayer[toActSeat]!;
      const holdsTheTrick = snap.board.length === 0; // cleared once both opponents pass
      if (holdsTheTrick) {
        const hand = (room.snapshotFor(pid).seats.find((s) => s.isYou)!.cards ?? []).filter(
          (c): c is string => typeof c === 'string',
        );
        await room.command(pid, { kind: 'act', action: { type: 'play', cards: [hand[0]!] } });
      } else {
        await room.command(pid, { kind: 'act', action: { type: 'pass' } });
      }
    }

    await until(() => room.snapshotFor(p0).phase !== 'IN_HAND');

    // Strict Chip Conservation Assertion across all accounts including rake sink
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);

  /**
   * THE ROOM MUST DRAW THE JACKPOT ON THE DEAL'S OWN SEED.
   *
   * The engine fix is only half of it: the room is what calls processJackpot, and it used to pass
   * `${roundId}:seed` — a string anyone holding a round id can reproduce, which makes the draw
   * predictable. This reaches into the protected call to capture what the room actually passed.
   */
  it('draws the jackpot on the final seed of the deal, never on the round id', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const ids = [players.create('A').id, players.create('B').id, players.create('C').id];

    const seen: Array<{ roundId: string; seed: string }> = [];

    class SpyRoom extends DouDiZhuRoom {
      protected override async processJackpot(profit: number, roundId: string, seed: string) {
        seen.push({ roundId, seed });
        await super.processJackpot(profit, roundId, seed);
      }
      /** The engine, so the test can compare against the seed the cards actually came from. */
      engineRound() {
        return (this as unknown as { game?: { roundInfo(): { finalSeed: string } | undefined } })
          .game?.roundInfo();
      }
    }

    const room = new SpyRoom(
      {
        id: 'ddz-seed',
        name: 'Seed Check',
        game: 'dou-di-zhu',
        baseStake: 100,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 3,
        rakeBps: 500,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    const noop = { sendSnapshot: () => {} };
    for (const id of ids) room.join(id, noop);
    for (let i = 0; i < 3; i++) await room.command(ids[i]!, { kind: 'sit', seat: i, buyIn: BUY_IN });

    await until(() => room.snapshotFor(ids[0]!).phase === 'IN_HAND');
    const dealt = room.engineRound();

    for (let step = 0; step < 5; step++) {
      const toAct = room.snapshotFor(ids[0]!).toActSeat;
      if (toAct === null) break;
      try {
        await room.command(ids[toAct]!, {
          kind: 'act',
          action: { type: step === 0 ? 'bid-3' : 'bid-0' },
        });
      } catch {
        break;
      }
    }

    for (let step = 0; step < 300; step++) {
      const snap = room.snapshotFor(ids[0]!);
      if (snap.phase !== 'IN_HAND') break;
      const toAct = snap.toActSeat;
      if (toAct === null) break;
      const pid = ids[toAct]!;
      if (snap.board.length === 0) {
        const hand = (room.snapshotFor(pid).seats.find((s) => s.isYou)!.cards ?? []).filter(
          (c): c is string => typeof c === 'string',
        );
        await room.command(pid, { kind: 'act', action: { type: 'play', cards: [hand[0]!] } });
      } else {
        await room.command(pid, { kind: 'act', action: { type: 'pass' } });
      }
    }

    await until(() => seen.length > 0, 8_000);

    const drawn = seen[0]!;
    expect(drawn.seed).toBe(dealt!.finalSeed);
    expect(drawn.seed).not.toBe(`${drawn.roundId}:seed`);
    expect(drawn.seed).not.toContain(drawn.roundId);

    room.dispose();
  }, 20_000);
});
