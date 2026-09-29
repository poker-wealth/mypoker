import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { BaccaratRoom } from '../../src/live/baccarat-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type { SettlementFailureReport, TableSettlementRequest } from '../../src/core/financial-core-client';

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

describe('BaccaratRoom — Live Room Integration', () => {
  it('registers baccarat table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const baccaratTable = hub.tables().find((t) => t.tableId === 'baccarat');
    expect(baccaratTable).toBeDefined();
    expect(baccaratTable?.variant).toBe('Baccarat');
    await hub.close();
  });

  it('seats two players, resolves hand, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new BaccaratRoom(
      {
        id: 'baccarat-1',
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

    // Bob (bettor) bets on Player
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 200 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN');

    const snap = room.snapshotFor(alice);
    expect(snap.phase).toBe('SHOWDOWN');
    /**
     * The hands travel in `gameState`, one per side.
     *
     * This used to read `board.length > 0`, back when both hands were flattened into that array
     * with a '|' between them — which the felt then drew as a card face reading "|". Asserting them
     * apart is also a better check: it catches one side arriving empty, which the flat array could
     * not distinguish.
     */
    const round = snap.gameState as {
      playerCards: string[];
      bankerCards: string[];
      outcome: string | null;
    };
    expect(round.playerCards.length).toBeGreaterThan(0);
    expect(round.bankerCards.length).toBeGreaterThan(0);
    expect(round.outcome).not.toBeNull();

    // Verify ledger-level money conservation including rake sink
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);
});

/**
 * BUG-11: `resolveRound` called `game.start()` (which settles via FC) with no try/catch. A rejected
 * settlement — the ledger unreachable, a 409 — left the table stuck IN_HAND forever: nothing resets
 * `phase`, and a seat's `stack` mirror is only written by the net-delta loop AFTER `game.start()`
 * resolves, so a throw from it means no stack moved either. Mirrors the niu-niu-room recovery and
 * PokerRoom's own BUG-03 fix: `abandonRound` puts the table back to WAITING and reports the failure,
 * and the table deals again on its own rather than sitting dead.
 */
describe('BaccaratRoom — settlement failure recovery (BUG-11)', () => {
  it('recovers to WAITING with stacks unchanged, reports the failure, and deals again', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;

    const realSettle = bank.settleTableHand.bind(bank);
    let calls = 0;
    bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('financial-core unreachable'));
      return realSettle(req);
    };
    const reportSpy = jest.fn<Promise<void>, [SettlementFailureReport]>().mockResolvedValue(undefined);
    (bank as unknown as { reportSettlementFailure: typeof reportSpy }).reportSettlementFailure = reportSpy;

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug11',
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

    const before = new Map(room.snapshotFor(alice).seats.map((s) => [s.playerId, s.stack]));
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 200 } });

    await until(() => room.snapshotFor(alice).phase === 'WAITING');
    for (const seat of room.snapshotFor(alice).seats) {
      expect(seat.stack).toBe(before.get(seat.playerId));
    }
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]![0]).toMatchObject({
      tableId: 'baccarat-bug11',
      reason: expect.stringContaining('financial-core unreachable'),
    });

    // The table recovers rather than freezing — a second hand deals on its own.
    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 2,
      10_000,
    );
    room.dispose();
  }, 15_000);

  /**
   * The auditor rejected the original fix: it reused one `BaccaratGame` for the room's whole
   * lifetime and only advanced it with `nextRound()` on the success path. After an abandon the
   * instance was left holding the failed round's bets and a state machine stuck in
   * BETTING/RESOLVED, so the *next* round either settled stale bets for players who never
   * re-bet, or threw 'betting is closed' forever. A fresh `BaccaratGame` per round (built in
   * `maybeStartRound`, same as lottery-room.ts) means round 2 never sees round 1's leftovers
   * regardless of how round 1 died.
   */
  it('a round that fails settlement is followed by a round that settles only who actually bet', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const carol = players.create('Carol').id;

    const realSettle = bank.settleTableHand.bind(bank);
    let calls = 0;
    const requests: TableSettlementRequest[] = [];
    bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      calls += 1;
      requests.push(req);
      if (calls === 1) return Promise.reject(new Error('financial-core unreachable'));
      return realSettle(req);
    };

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug11-stale-bets',
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

    // Round 1: both bettors bet — the settle for this round fails (calls === 1).
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 200 } });
    await room.command(carol, { kind: 'act', action: { type: 'tie', amount: 100 } });

    // Round 2: only Bob bets this time. Carol stands there un-bet, so resolution has to come from
    // the betting timer expiring, not the "everyone has bet" trigger — exactly the case where a
    // reused game would still be holding Carol's round-1 bet.
    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 2,
      10_000,
    );
    const carolStackBeforeRound2 = room.snapshotFor(alice).seats.find((s) => s.playerId === carol)!.stack;
    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 200 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);

    expect(calls).toBe(2);
    const secondRequest = requests[1]!;
    const secondRequestPlayers = [...secondRequest.losers, ...secondRequest.winners].map((p) => p.playerAccountId);
    expect(secondRequestPlayers).not.toContain(carol);

    const carolStackAfter = room.snapshotFor(alice).seats.find((s) => s.playerId === carol)!.stack;
    expect(carolStackAfter).toBe(carolStackBeforeRound2);

    room.dispose();
  }, 15_000);

  /**
   * The second way the reused-game bug bit: settlement itself can succeed and a LATER step (the
   * jackpot draw) still throw. That left the state machine RESOLVED with `nextRound()` never
   * called, so the next round's `setBanker` threw 'betting is closed' forever. A fresh game per
   * round sidesteps this the same way — round 2 gets a brand-new instance in BETTING regardless
   * of what state round 1's instance was abandoned in.
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

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug11-post-settle-throw',
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

    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 200 } });

    // Round 1's settlement went through (money moved) but the jackpot step threw, so the room
    // abandons — WAITING, then it deals round 2 on its own.
    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 2,
      10_000,
    );

    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 200 } });
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
describe('BaccaratRoom — settlement recovery from a lost response (BUG-20)', () => {
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

    const room = new BaccaratRoom(
      {
        id: 'baccarat-bug20',
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

    await room.command(bob, { kind: 'act', action: { type: 'player', amount: 200 } });
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

    room.dispose();
  }, 15_000);
});
