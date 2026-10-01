import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DouDiZhuRoom } from '../../src/live/dou-di-zhu-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type { TableSettlementRequest } from '../../src/core/financial-core-client';

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
 * BUG-07 follow-up, D6: a leaving seat doesn't count toward Dou Di Zhu's exact-three requirement,
 * and is never dealt in — there is no way to sub a fourth player into a hand already running, so
 * a table stuck with one leaving seat simply waits rather than deals two real players plus a
 * chair that is trying to leave.
 */
describe('DouDiZhuRoom — a leaving seat is never dealt in (BUG-07)', () => {
  it('does not deal while one of the three occupied seats is leaving', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const p0 = players.create('P0').id;
    const p1 = players.create('P1').id;
    const p2 = players.create('P2').id;

    const room = new DouDiZhuRoom(
      {
        id: 'dou-di-zhu-bug07-leaving',
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

    await room.command(p0, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(p1, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    // p1 marked leaving directly — the state a stuck failed release would leave it in — while
    // only two are seated, so no deal has been attempted yet.
    const internals = room as unknown as {
      seats: Array<{ leaving?: 'stand' | 'disconnect' | 'drain' } | null>;
    };
    internals.seats[1]!.leaving = 'stand';

    // The third seat brings the table to three occupied, which would normally deal immediately.
    await room.command(p2, { kind: 'sit', seat: 2, buyIn: BUY_IN });
    await wait(100);
    expect(room.snapshotFor(p0).phase).toBe('WAITING');
    // F6 (audit fix): says WHY, rather than the generic "waiting for players" a table that is
    // actually full would otherwise show.
    expect(room.snapshotFor(p0).message).toMatch(/seat to clear/);

    room.dispose();
  });
});

/**
 * F7 / BUG-21 (audit fix on BUG-07 follow-up): base `stand()` only ever refused
 * `phase === 'IN_HAND' && seat.bet > 0` — baccarat-shaped, and wrong for Dou Di Zhu, which never
 * carries a bet at all (mid-hand `seat.bet` stays 0), so the old check never fired here and a
 * player could stand mid-hand, leaving the other two stuck on a turn that will never come and any
 * later settlement debiting a seat that is already gone.
 */
describe('DouDiZhuRoom — cannot stand mid-hand (BUG-21)', () => {
  it('refuses to stand once the hand is dealt', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const p0 = players.create('P0').id;
    const p1 = players.create('P1').id;
    const p2 = players.create('P2').id;

    const room = new DouDiZhuRoom(
      {
        id: 'dou-di-zhu-bug21-stand',
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

    await room.command(p0, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(p1, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await room.command(p2, { kind: 'sit', seat: 2, buyIn: BUY_IN });
    await until(() => room.snapshotFor(p0).phase === 'IN_HAND');

    await expect(room.command(p1, { kind: 'stand' })).rejects.toThrow(/live bet/);
    expect(room.snapshotFor(p0).seats.some((s) => s.playerId === p1)).toBe(true);

    room.dispose();
  });
});

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

/**
 * BUG-25: `handleAct` used to call `this.game.play(playerId, cards)` without awaiting it. `play()`
 * settles through `finish()` when it empties a hand, so a settlement refusal on the winning play
 * was an unhandled rejection (process-fatal in Node 15+) — and, because `winner` is set
 * synchronously before `finish()` ever awaits FC, the room mirrored stacks in `resolveRound`
 * regardless of whether that settlement actually landed.
 */
describe('DouDiZhuRoom — a failed settlement on the final play does not crash the table (BUG-25)', () => {
  class RefusingBank extends ChipBank {
    refuse = true;
    failureReports: Array<{ tableId: string; reason: string }> = [];
    override async settleTableHand(
      req: Parameters<ChipBank['settleTableHand']>[0],
    ): Promise<{ roundId: string; applied: boolean }> {
      if (this.refuse) throw new Error('settlement refused by the ledger');
      return super.settleTableHand(req);
    }
    async reportSettlementFailure(req: { tableId: string; reason: string }): Promise<void> {
      this.failureReports.push(req);
    }
  }

  it('is caught, not an unhandled rejection, leaves the table WAITING and stacks untouched', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);

    try {
      const players = new DevPlayers({ startingChips: 10_000 });
      const bank = new RefusingBank(players);
      const p0 = players.create('P0').id;
      const p1 = players.create('P1').id;
      const p2 = players.create('P2').id;

      const room = new DouDiZhuRoom(
        {
          id: 'dou-di-zhu-bug25',
          name: 'Test Dou Di Zhu',
          game: 'dou-di-zhu',
          baseStake: 100,
          minBuyIn: 1_000,
          maxBuyIn: 50_000,
          maxSeats: 3,
          rakeBps: 500,
          showdownDelayMs: 5_000,
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

      for (let step = 0; step < 5; step++) {
        const snap = room.snapshotFor(p0);
        // Loop by the engine's actual stage, not by catching whatever 'not bidding' throws once
        // bidding ends — a catch-and-break there would just as happily swallow a real regression in
        // the bidding flow as it would the expected end-of-auction state.
        if (snap.stage !== 'BIDDING') break;
        const toActSeat = snap.toActSeat;
        if (toActSeat === null) break;
        const pid = toActSeat === 0 ? p0 : toActSeat === 1 ? p1 : p2;
        await room.command(pid, { kind: 'act', action: { type: step === 0 ? 'bid-3' : 'bid-0' } });
      }

      // Same terminating line of play as the happy-path test: whoever holds the trick leads their
      // lowest card, the others always pass, so the leader empties their hand and wins — which is
      // exactly the play the refusing bank turns down.
      const seatPlayer = [p0, p1, p2];
      for (let step = 0; step < 300; step++) {
        const snap = room.snapshotFor(p0);
        if (snap.phase !== 'IN_HAND') break;
        const toActSeat = snap.toActSeat;
        if (toActSeat === null) break;

        const pid = seatPlayer[toActSeat]!;
        const holdsTheTrick = snap.board.length === 0;
        if (holdsTheTrick) {
          const hand = (room.snapshotFor(pid).seats.find((s) => s.isYou)!.cards ?? []).filter(
            (c): c is string => typeof c === 'string',
          );
          await room.command(pid, { kind: 'act', action: { type: 'play', cards: [hand[0]!] } });
        } else {
          await room.command(pid, { kind: 'act', action: { type: 'pass' } });
        }
      }

      await until(() => room.snapshotFor(p0).phase === 'WAITING');

      const after = room.snapshotFor(p0);
      expect(after.phase).toBe('WAITING');
      // Settlement was refused, so `fc.settleTableHand` never applied — no stack should have moved.
      for (const seat of after.seats.filter((s) => s.playerId)) expect(seat.stack).toBe(BUY_IN);
      expect(bank.failureReports.length).toBeGreaterThan(0);
      expect(bank.failureReports[0]!.tableId).toBe('dou-di-zhu-bug25');
      // BUG-25 follow-up: resultMessage() used to keep reporting the previous (never-paid) winner for
      // the whole WAITING window, so the felt said "X wins" over a hand that settled nothing.
      expect(after.message ?? '').not.toMatch(/wins/);

      room.dispose();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(unhandled).toEqual([]);
  }, 20_000);

  it('still throws an illegal play to the player instead of treating it as a settlement failure', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const p0 = players.create('P0').id;
    const p1 = players.create('P1').id;
    const p2 = players.create('P2').id;

    const room = new DouDiZhuRoom(
      {
        id: 'dou-di-zhu-bug25-illegal',
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

    await room.command(p0, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(p1, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await room.command(p2, { kind: 'sit', seat: 2, buyIn: BUY_IN });

    await until(() => room.snapshotFor(p0).phase === 'IN_HAND');

    // Still BIDDING — the room's own pre-checks (seated, turn, card ownership/legality) do not
    // catch a 'play' sent before the engine has left bidding, so this reaches `game.play()`, which
    // rejects with no winner ever set. That must surface to the player, not be swallowed as a
    // settlement failure.
    const toActSeat = room.snapshotFor(p0).toActSeat!;
    const pid = toActSeat === 0 ? p0 : toActSeat === 1 ? p1 : p2;
    const hand = (room.snapshotFor(pid).seats.find((s) => s.isYou)!.cards ?? []).filter(
      (c): c is string => typeof c === 'string',
    );

    await expect(
      room.command(pid, { kind: 'act', action: { type: 'play', cards: [hand[0]!] } }),
    ).rejects.toThrow(/not in play/);
    expect(room.snapshotFor(p0).phase).toBe('IN_HAND');

    room.dispose();
  });
});

/**
 * BUG-20: the winning `play()`'s settlement can throw even after FC already committed it — a lost
 * response, not a refusal. Before this fix the BUG-25 catch treated every throw on the winning play
 * as a genuine refusal and abandoned the round, even one the ledger had actually already paid.
 */
describe('DouDiZhuRoom — settlement recovery from a lost response (BUG-20)', () => {
  class LostResponseBank extends ChipBank {
    private failedOnce = false;
    override async settleTableHand(
      req: TableSettlementRequest,
    ): Promise<{ roundId: string; applied: boolean }> {
      const result = await super.settleTableHand(req);
      if (!this.failedOnce) {
        this.failedOnce = true;
        throw new Error('socket hang up');
      }
      return result;
    }
  }

  it('resolves the round (mirrors stacks, draws the jackpot) once FC confirms the lost settlement actually committed', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new LostResponseBank(players);
    const p0 = players.create('P0').id;
    const p1 = players.create('P1').id;
    const p2 = players.create('P2').id;
    const startingTotal = players.totalChips();

    const room = new DouDiZhuRoom(
      {
        id: 'dou-di-zhu-bug20',
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

    for (let step = 0; step < 5; step++) {
      const snap = room.snapshotFor(p0);
      if (snap.stage !== 'BIDDING') break;
      const toActSeat = snap.toActSeat;
      if (toActSeat === null) break;
      const pid = toActSeat === 0 ? p0 : toActSeat === 1 ? p1 : p2;
      await room.command(pid, { kind: 'act', action: { type: step === 0 ? 'bid-3' : 'bid-0' } });
    }

    // Same terminating line of play as the happy-path test above: whoever holds the trick leads
    // their lowest card, the others always pass — the leader empties their hand and wins, which is
    // exactly the play `LostResponseBank` turns into a lost response on.
    const seatPlayer = [p0, p1, p2];
    for (let step = 0; step < 300; step++) {
      const snap = room.snapshotFor(p0);
      if (snap.phase !== 'IN_HAND') break;
      const toActSeat = snap.toActSeat;
      if (toActSeat === null) break;

      const pid = seatPlayer[toActSeat]!;
      const holdsTheTrick = snap.board.length === 0;
      if (holdsTheTrick) {
        const hand = (room.snapshotFor(pid).seats.find((s) => s.isYou)!.cards ?? []).filter(
          (c): c is string => typeof c === 'string',
        );
        await room.command(pid, { kind: 'act', action: { type: 'play', cards: [hand[0]!] } });
      } else {
        await room.command(pid, { kind: 'act', action: { type: 'pass' } });
      }
    }

    await until(() => room.snapshotFor(p0).phase === 'SHOWDOWN');

    // Conserved (the ledger always reflects the real settlement here, since `LostResponseBank` calls
    // `super` before throwing) AND correctly mirrored: every seat's room-side stack equals what the
    // ledger actually has locked for that player — the assertion that is false pre-fix, when a lost
    // response on the winning play sent the round through `abandonRoundAndRedeal` instead.
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);
    for (const seat of room.snapshotFor(p0).seats) {
      if (!seat.playerId) continue;
      expect(seat.stack).toBe(players.locked(seat.playerId));
    }
    expect(room.snapshotFor(p0).message ?? '').toMatch(/wins/);

    room.dispose();
  }, 20_000);
});
