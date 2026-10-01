import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { SanZhangRoom } from '../../src/live/san-zhang-room';
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

describe('SanZhangRoom — Live Room Integration', () => {
  it('registers san-zhang table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const szTable = hub.tables().find((t) => t.tableId === 'san-zhang');
    expect(szTable).toBeDefined();
    expect(szTable?.variant).toBe('San Zhang');
    await hub.close();
  });

  it('seats two players, resolves hand, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new SanZhangRoom(
      {
        id: 'san-zhang-1',
        name: 'Test San Zhang',
        game: 'san-zhang',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Bob bets
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN');

    const snap = room.snapshotFor(alice);
    expect(snap.phase).toBe('SHOWDOWN');

    // Verify ledger-level money conservation including rake sink
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);
});

/**
 * BUG-26: San Zhang reused one `SanZhangGame` for the room's whole lifetime, advancing it with
 * `nextRound()` only on the success path (`nextRound()` requires RESOLVED). After an abandoned
 * round — settlement refused, or a later step like the jackpot throwing — the instance was left
 * mid-state, and the next round's `setBanker`/`placeBet` threw forever: a single failed settlement
 * wedged the table for good, the same shape as the baccarat/niu-niu fix this mirrors.
 */
describe('SanZhangRoom — a fresh game per round survives an abandon (BUG-26)', () => {
  /**
   * BUG-26 follow-up — the stale-bet shape the old "two rounds in a row" test never actually
   * exercised: `SanZhangGame.start()` calls `fc.settleTableHand` BEFORE transitioning its state
   * machine to `RESOLVED` (see `san-zhang-game.ts`), so a rejected settlement leaves the state
   * machine in `BETTING` — pre-fix, round 2's `setBanker`/`placeBet` never actually throw for this
   * failure mode (that only happens for the OTHER shape, test 2 below, where settlement itself
   * succeeds and a later step throws). The old test's docstring claimed otherwise; it wasn't testing
   * what it said it was.
   *
   * What pre-fix reuse actually does here: `setBanker` only deletes the INCOMING banker's own entry
   * from `this.bets` (`this.bets.delete(playerId)`), so a bettor who does not rebet in round 2 is
   * simply never removed from the reused game's internal `bets` Map. Round 2's `start()` then reads
   * `participants = [this.banker, ...this.bets.keys()]` and silently deals carol back in — and
   * settles her — on her ROUND 1 stake, even though her room-level seat.bet is 0 and she took no
   * action in round 2. The fresh `SanZhangGame` per round (`maybeStartRound`) starts that Map empty,
   * so carol simply never enters it unless she bets.
   */
  it('a bettor who sits out round 2 is not silently resettled on her round-1 bet (stale bet)', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const carol = players.create('Carol').id;
    const startingTotal = players.totalChips();

    const realSettle = bank.settleTableHand.bind(bank);
    let calls = 0;
    const recorded: TableSettlementRequest[] = [];
    bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('financial-core unreachable'));
      recorded.push(req);
      return realSettle(req);
    };

    const room = new SanZhangRoom(
      {
        id: 'san-zhang-bug26-stale-bet',
        name: 'Test San Zhang',
        game: 'san-zhang',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 200,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    // Alice sits first, so she is the banker (base-room's `isFirst` -> `createSeatRecord`).
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await room.command(carol, { kind: 'sit', seat: 2, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Round 1: both non-bankers bet, which fires `resolveRound` immediately; its settlement is
    // refused (calls === 1) and the round is abandoned.
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });
    await room.command(carol, { kind: 'act', action: { type: 'bet', amount: 100 } });

    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 2,
      10_000,
    );

    // Round 2: only bob rebets — carol sits it out entirely. Nothing auto-triggers `resolveRound`
    // (carol's seat.bet is still 0), so this waits out the real betting timer instead.
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);
    expect(calls).toBe(2);
    expect(recorded).toHaveLength(1);

    // The round-2 settlement request must involve only alice (banker) and bob (the only bettor) —
    // carol, who never acted in round 2, must not appear as either a loser or a winner.
    const round2Ids = new Set([...recorded[0]!.losers, ...recorded[0]!.winners].map((p) => p.playerAccountId));
    expect(round2Ids).not.toContain(carol);
    for (const id of round2Ids) expect([alice, bob]).toContain(id);

    const carolSeat = room.snapshotFor(alice).seats.find((s) => s.playerId === carol)!;
    expect(carolSeat.stack).toBe(BUY_IN);
    expect(room.snapshotFor(alice).winners).not.toContain(carolSeat.index);

    // Ledger-level conservation across both the refused round and the settled one.
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 20_000);

  /**
   * The second way the reused-game bug bit: settlement itself can succeed and a LATER step (the
   * jackpot draw) still throw. That left the state machine RESOLVED with `nextRound()` never
   * called, so the next round's `setBanker` threw 'betting is closed' forever. A fresh game per
   * round sidesteps this the same way — round 2 gets a brand-new instance in BETTING regardless of
   * what state round 1's instance was abandoned in.
   */
  it('deals and settles round 2 after round 1 settles but a later step throws', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;

    let settleCalls = 0;
    const realSettle = bank.settleTableHand.bind(bank);
    bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      settleCalls += 1;
      return realSettle(req);
    };

    const room = new SanZhangRoom(
      {
        id: 'san-zhang-bug26-post-settle-throw',
        name: 'Test San Zhang',
        game: 'san-zhang',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    let jackpotCalls = 0;
    const realProcessJackpot = (room as unknown as { processJackpot: (...a: unknown[]) => Promise<void> })
      .processJackpot.bind(room);
    (room as unknown as { processJackpot: (...a: unknown[]) => Promise<void> }).processJackpot = async (
      ...args: unknown[]
    ): Promise<void> => {
      jackpotCalls += 1;
      if (jackpotCalls === 1) throw new Error('jackpot pool unavailable');
      return realProcessJackpot(...args);
    };

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });

    // Round 1's settlement went through (money moved) but the jackpot step threw, so the room
    // abandons — WAITING, then it deals round 2 on its own.
    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 2,
      10_000,
    );

    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);

    expect(settleCalls).toBe(2);
    room.dispose();
  }, 15_000);
});

/**
 * BUG-20: `fc.settleTableHand` can throw even after FC already committed it — a lost response, not
 * a refusal. `seat.stack` (the room's own mirror) must equal `players.locked` (the ledger's real
 * record) after settlement either way: pre-fix, the room's catch never mirrored on any throw, so the
 * two disagree — the ledger moved, the seat did not.
 */
describe('SanZhangRoom — settlement recovery from a lost response (BUG-20)', () => {
  it('mirrors the stacks once FC confirms the lost settlement actually committed', async () => {
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

    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new LostResponseBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new SanZhangRoom(
      {
        id: 'san-zhang-bug20',
        name: 'Test San Zhang',
        game: 'san-zhang',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN');

    // Conserved (the ledger always reflects the real settlement here, since `LostResponseBank` calls
    // `super` before throwing) AND correctly mirrored: every seat's room-side stack equals what the
    // ledger actually has locked for that player — the assertion that is false pre-fix, when the
    // mirror never ran.
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);
    for (const seat of room.snapshotFor(alice).seats) {
      if (!seat.playerId) continue;
      expect(seat.stack).toBe(players.locked(seat.playerId));
    }

    // Recovered all the way through, not just the stacks: the game's own state machine reached
    // RESOLVED too (BUG-20 follow-up) — pre-fix, `start()` threw before `sm.transition('RESOLVED')`
    // ever ran, leaving a recovered round's game instance stuck in BETTING forever.
    expect((room as unknown as { game: { state: string } }).game.state).toBe('RESOLVED');

    room.dispose();
  }, 15_000);
});
