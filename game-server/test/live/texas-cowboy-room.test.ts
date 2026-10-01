import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { TexasCowboyRoom } from '../../src/live/texas-cowboy-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type { TableSettlementRequest } from '../../src/core/financial-core-client';

/**
 * Pin the deal so the settlement test below can't land on a TIE (~4% of live runs) -- a tie voids
 * both bets by design and skips settleTableHand entirely, which is a real, useful behaviour but not
 * what that test is checking, and left `sinks.rake` occasionally `undefined` instead of `100`.
 *
 * Every other test in this file either never reaches `deal()` (refusal/hold/stand tests, which throw
 * before betting closes) or explicitly supplies its own `bet`-only outcome (the grace test lets the
 * round deal and settle, but Bob is the lone bettor and a lone bettor nets 0 either way (engine
 * settleBets: no opposing stake, so no losing pool), so it does not depend on which cards come out;
 * the F7 stand and refusal tests act during the betting window before any deal) -- none of them
 * depend on which cards come out, so pinning the deck for the whole file is safe.
 */
jest.mock('../../src/games/texas-cowboy/poker', () => {
  const actual = jest.requireActual<typeof import('../../src/games/texas-cowboy/poker')>(
    '../../src/games/texas-cowboy/poker',
  );
  // dealRound: cowboy = deck[0..1], cowgirl = deck[2..3], board = deck[4..8]. Cowboy AA vs cowgirl 2-3 on
  // K 9 7 5 4 rainbow: pair of aces beats king-high, no straight/flush possible — never a TIE (P≈4% live),
  // which voids both bets before settleTableHand and leaves rake undefined.
  const PINNED = ['As', 'Ah', '2c', '3d', 'Kd', '9s', '7c', '5h', '4s'];
  return {
    ...actual,
    shuffleDeck: (deck: string[]): string[] => [...PINNED, ...deck.filter((c) => !PINNED.includes(c))],
  };
});

/**
 * TEXAS COWBOY — the room-level conservation test the table never had (ESTHER_V2 task 2).
 *
 * This table is the one most worth pinning. Nobody banks it, so the round is player-funded: the
 * losing stakes ARE the prize pool and the winners divide them. It previously paid winners without
 * calling the ledger at all — minting chips — which only surfaced when a probe hit "cannot release
 * more than is locked". So the assertion here is the whole point of the game's design: after a
 * round, every chip is still accounted for, and the house has taken its cut and nothing more.
 */

const BUY_IN = 5_000;

const wait = (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(10);
  }
  throw new Error('timed out waiting for state');
}

/**
 * Every room a test opens, closed in afterEach — NOT at the bottom of the test body.
 *
 * The room runs its own round clock. With `room.dispose()` as a test's last line, any assertion
 * that fails above it skips the dispose, the clock keeps scheduling rounds, and Jest never exits:
 * a broken build shows up as a run that hangs silently rather than one that fails. Found by
 * breaking the trail recording on purpose — the test caught it, and then the run sat for two hours.
 */
const openRooms: TexasCowboyRoom[] = [];
afterEach(() => {
  for (const room of openRooms.splice(0)) room.dispose();
});

function newRoom(id: string, deps: { directory: DevPlayers; fc: ChipBank }): TexasCowboyRoom {
  const room = new TexasCowboyRoom(
    {
      id,
      name: 'Test Texas Cowboy',
      game: 'texas-cowboy',
      minBuyIn: 1_000,
      maxBuyIn: 50_000,
      maxSeats: 100,
      rakeBps: 500,
    },
    deps,
  );
  openRooms.push(room);
  return room;
}

describe('TexasCowboyRoom — Live Room Integration', () => {
  it('registers texas-cowboy table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const table = hub.tables().find((t) => t.tableId === 'texas-cowboy');
    expect(table).toBeDefined();
    await hub.close();
  });

  it('settles a round of opposing bets and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = newRoom('texas-cowboy-1', { directory: players, fc: bank });

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    // Snapshot each player's total (available + locked) right after buy-in, before either stakes a
    // bet, so the net assertions below isolate what the bet itself does and aren't diluted by the
    // buy-in's own available -> locked shift.
    const aliceBeforeBet = players.available(alice) + players.locked(alice);
    const bobBeforeBet = players.available(bob) + players.locked(bob);

    // Opposite sides of the same market, so one of them must lose and fund the other. 2,000, not
    // 100: at the default 50bps jackpot rate a 100-chip pot injects floor(100*50/10000) = 0 either
    // way, which would let this test pass whether or not BUG-24's `jackpotBps: 0` is actually wired
    // through — a stake large enough to floor to a nonzero jackpot is what makes the assertions below
    // load-bearing.
    await room.command(alice, {
      kind: 'act',
      action: { type: 'bet', amount: 2_000, selection: 'cowboy_win' },
    });
    await room.command(bob, {
      kind: 'act',
      action: { type: 'bet', amount: 2_000, selection: 'cowgirl_win' },
    });

    // The round runs on its own clock: betting window, deal, three reveals, then settlement.
    await until(() => players.totalChips() + bank.sinkTotal() !== startingTotal || false, 1_000)
      .catch(() => undefined);
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 40_000);

    // The board's trails come from the same judgement that pays money. After one evaluated round
    // every market has exactly one entry, exactly one of the three outcome markets hit, and each
    // market that hit shows a zero, exact vacancy while the others show one round, not exact.
    const gs = room.snapshotFor(alice).gameState as {
      result: { winner: 'COWBOY' | 'COWGIRL' | 'TIE' } | null;
      markets: { id: string }[];
      marketHistory?: Record<string, boolean[]>;
      vacant?: Record<string, { rounds: number; exact: boolean }>;
    };
    for (const m of gs.markets) expect(gs.marketHistory?.[m.id]).toHaveLength(1);
    const outcomeHits = ['cowboy_win', 'cowgirl_win', 'tie'].filter((id) => gs.marketHistory?.[id]?.[0]);
    expect(outcomeHits).toHaveLength(1);
    const expectedWinner = { cowboy_win: 'COWBOY', cowgirl_win: 'COWGIRL', tie: 'TIE' }[outcomeHits[0] as 'cowboy_win'];
    expect(gs.result?.winner).toBe(expectedWinner);
    // The pin above is meant to make this a guaranteed, decisive COWBOY win -- assert that directly
    // rather than only through the market bookkeeping, so a mock that silently stopped applying would
    // fail loudly here instead of coincidentally still passing on an unpinned, occasionally-tied deal.
    expect(gs.result?.winner).toBe('COWBOY');
    for (const m of gs.markets) {
      const hit = gs.marketHistory![m.id]![0];
      expect(gs.vacant?.[m.id]).toEqual(hit ? { rounds: 0, exact: true } : { rounds: 1, exact: false });
    }

    await wait(6_000); // settlement runs a beat after showdown

    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    // The pinned deal makes COWBOY the decisive winner (Alice bet cowboy_win, Bob cowgirl_win), so the
    // net movement is exact, not just conserved: Alice's stake comes back plus Bob's stake minus the
    // rake, Bob's stake is gone entirely.
    const aliceAfter = players.available(alice) + players.locked(alice);
    const bobAfter = players.available(bob) + players.locked(bob);
    expect(aliceAfter - aliceBeforeBet).toBe(1_900);
    expect(bobAfter - bobBeforeBet).toBe(-2_000);

    // BUG-24: this table draws no jackpot (the deal is not provably fair), so settlement must not
    // inject into any jp:<tier>:texas-cowboy-1 pool — money nothing can ever pay out. The whole
    // 2,000-chip losing stake's cut is the rake alone: floor(2000 * 500 / 10000) = 100, winner nets
    // 1900.
    const sinks = bank.sinkBalances();
    for (const [account, balance] of Object.entries(sinks)) {
      if (account.startsWith('jp:')) expect(balance).toBe(0);
    }
    expect(sinks.rake).toBe(100);
    expect(room.snapshotFor(alice).jackpot).toBeNull();

    room.dispose();
  }, 60_000);

  it('refuses a bet larger than the player can cover', async () => {
    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    const room = newRoom('texas-cowboy-2', { directory: players, fc: bank });
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    await expect(
      room.command(alice, {
        kind: 'act',
        action: { type: 'bet', amount: BUY_IN * 10, selection: 'cowboy_win' },
      }),
    ).rejects.toThrow();

    // The refusal must not have moved anything.
    const seat = room.snapshotFor(alice).seats.find((s) => s.isYou)!;
    expect(seat.bet).toBe(0);

    room.dispose();
  }, 20_000);

  it('holds staked chips out of the stack so the same money cannot be bet twice', async () => {
    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    const room = newRoom('texas-cowboy-3', { directory: players, fc: bank });
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    // Stake most of the stack, then try to stake most of it again.
    await room.command(alice, {
      kind: 'act',
      action: { type: 'bet', amount: BUY_IN - 100, selection: 'cowboy_win' },
    });

    await expect(
      room.command(alice, {
        kind: 'act',
        action: { type: 'bet', amount: BUY_IN - 100, selection: 'tie' },
      }),
    ).rejects.toThrow();

    room.dispose();
  }, 20_000);

  /**
   * BUG-07 follow-up, D4. This room's open betting window IS phase `WAITING` — real chips ride on
   * `seat.bet` while it's open — so the base default (table-wide `WAITING` means idle, safe to
   * release) is exactly wrong here: it would release a disconnected bettor mid-window, the very
   * bug commit 2 of BUG-07 first added the `seat.bet` check for. `graceReleaseSafe` is overridden
   * to ignore phase entirely and go by the bet alone.
   */
  it('does not release a disconnected bettor mid-window, releases once the round settles', async () => {
    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const bobBefore = players.find(bob)!.available;

    const room = newRoom('texas-cowboy-grace', { directory: players, fc: bank });

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await room.command(bob, {
      kind: 'act',
      action: { type: 'bet', amount: 100, selection: 'cowboy_win' },
    });

    const internals = room as unknown as {
      seats: Array<{ playerId: string; connected: boolean } | null>;
      armDisconnectGrace(playerId: string, graceMs?: number): void;
    };
    const seat = internals.seats.find((s) => s?.playerId === bob);
    if (!seat) throw new Error('bob is not seated');
    seat.connected = false;
    internals.armDisconnectGrace(bob, 15);

    await wait(200);
    // Still there — a live bet, window genuinely open (phase happens to read WAITING here).
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === bob)).toBe(true);

    // Let the round run its real course: window closes, deals, three reveals, settles — and
    // `startNextRound` calls `releaseDeparted` before it opens the next window.
    await until(() => !room.snapshotFor(alice).seats.some((s) => s.playerId === bob), 50_000);
    expect(players.find(bob)!.available).toBe(bobBefore);

    room.dispose();
  }, 60_000);

  /**
   * F7 / BUG-21 (audit fix on BUG-07 follow-up): base `stand()` only ever refused
   * `phase === 'IN_HAND' && seat.bet > 0` — this room's real money moves during its open betting
   * window, which is phase `WAITING`, not `IN_HAND`, so the old check never fired here and a
   * bettor could stand with a live stake mid-window, leaving `settleBets` to debit a released seat.
   */
  it('refuses to stand with a live bet during the open betting window', async () => {
    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    const room = newRoom('texas-cowboy-bug21-stand', { directory: players, fc: bank });
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(alice, {
      kind: 'act',
      action: { type: 'bet', amount: 100, selection: 'cowboy_win' },
    });

    await expect(room.command(alice, { kind: 'stand' })).rejects.toThrow(/live bet/);
    expect(room.snapshotFor(alice).seats.some((s) => s.playerId === alice)).toBe(true);

    room.dispose();
  }, 20_000);

  /**
   * BUG-20: `fc.settleTableHand` can throw even after FC already committed it — a lost response, not
   * a refusal. Before this fix, `settleRound`'s catch treated every throw as unpaid and left the
   * stakes exactly where they were, permanently disagreeing with a ledger that had already moved.
   */
  it('mirrors the stacks when the settlement response is lost but FC confirms it committed (BUG-20)', async () => {
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

    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new LostResponseBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = newRoom('texas-cowboy-bug20', { directory: players, fc: bank });
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    const aliceBeforeBet = players.available(alice) + players.locked(alice);
    const bobBeforeBet = players.available(bob) + players.locked(bob);

    // Same pinned deal as the conservation test above: alice bets cowboy_win, which wins decisively.
    await room.command(alice, { kind: 'act', action: { type: 'bet', amount: 2_000, selection: 'cowboy_win' } });
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 2_000, selection: 'cowgirl_win' } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 40_000);
    await wait(6_000); // settlement runs a beat after showdown

    // The LEDGER always reflects the real settlement here (LostResponseBank calls `super` before
    // throwing) — conservation on its own would pass even pre-fix. What pre-fix actually gets wrong
    // is the ROOM's own `seat.stack` mirror, which its catch skipped entirely on any throw: this is
    // the assertion that is false against the pre-fix code.
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);
    expect(bank.sinkBalances().rake).toBe(100);
    const aliceSeat = room.snapshotFor(alice).seats.find((s) => s.playerId === alice)!;
    const bobSeat = room.snapshotFor(alice).seats.find((s) => s.playerId === bob)!;
    expect(aliceSeat.stack).toBe(BUY_IN + 1_900); // net win mirrored onto the seat
    expect(bobSeat.stack).toBe(BUY_IN - 2_000); // net loss mirrored onto the seat
    const aliceAfter = players.available(alice) + players.locked(alice);
    const bobAfter = players.available(bob) + players.locked(bob);
    expect(aliceAfter - aliceBeforeBet).toBe(1_900);
    expect(bobAfter - bobBeforeBet).toBe(-2_000);

    room.dispose();
  }, 60_000);
});
