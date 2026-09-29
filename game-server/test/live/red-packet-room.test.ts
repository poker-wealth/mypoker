import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { RedPacketRoom } from '../../src/live/red-packet-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type {
  FinancialCoreClient,
  TableSettlementRequest,
} from '../../src/core/financial-core-client';

/** Captures the roundId of every settleTableHand call, without regard to whether it was applied. */
function recordingFc(): { fc: FinancialCoreClient; roundIds: string[] } {
  const roundIds: string[] = [];
  return {
    roundIds,
    fc: {
      async buyIn() {},
      async release() {},
      async settleRound(req) {
        return {
          roundId: req.roundId,
          sequence: [],
          amounts: { jackpot: '0', rake: '0', payout: '0' },
          accounts: {},
          hash: '',
        };
      },
      async settleTableHand(req: TableSettlementRequest) {
        roundIds.push(req.roundId);
        return { roundId: req.roundId, applied: true };
      },
    },
  };
}

/**
 * RED PACKET — the room-level conservation test the table never had (ESTHER_V2 task 2).
 *
 * The engine's own tests check the grid. This checks the thing that actually matters once money is
 * involved: after a real round on a real room, every chip is still somewhere. Losers pay exactly
 * what winners are paid plus the rake, and the table is not left holding anything.
 */

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

describe('RedPacketRoom — Live Room Integration', () => {
  it('registers red-packet table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const table = hub.tables().find((t) => t.tableId === 'red-packet');
    expect(table).toBeDefined();
    expect(table?.variant).toBe('Red Packet');
    await hub.close();
  });

  it('seats two players, resolves a round, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new RedPacketRoom(
      {
        id: 'red-packet-1',
        name: 'Test Red Packet',
        game: 'red-packet',
        size: 25,
        mineCount: 5,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 8,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Seat 0 banks the round; the other seat claims a packet.
    await room.command(bob, { kind: 'act', action: { type: '7', amount: 100 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);

    // Every chip accounted for: what the players hold, plus what the house took.
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);

  it('leaves nothing behind over several rounds', async () => {
    // One round balancing can hide a leak that only shows when reservations carry over.
    const players = new DevPlayers({ startingChips: 50_000 });
    const bank = new ChipBank(players);
    const ids = [players.create('A').id, players.create('B').id, players.create('C').id];
    const startingTotal = players.totalChips();

    const room = new RedPacketRoom(
      {
        id: 'red-packet-2',
        name: 'Test Red Packet',
        game: 'red-packet',
        size: 25,
        mineCount: 5,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 8,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    for (const [i, id] of ids.entries()) {
      await room.command(id, { kind: 'sit', seat: i, buyIn: BUY_IN });
    }

    // Tracked by hand number, not by phase: the room passes through WAITING between rounds too
    // quickly to catch, so waiting to observe that phase times out even though the table is fine.
    for (let round = 0; round < 3; round++) {
      const target = round + 1;
      await until(() => {
        const s = room.snapshotFor(ids[0]!);
        return s.handNumber === target && s.phase === 'IN_HAND';
      }, 10_000);

      const banker = room.snapshotFor(ids[0]!).seats.find((s) => s.isDealer)?.playerId;
      for (const [i, id] of ids.entries()) {
        if (id === banker) continue;
        await room.command(id, { kind: 'act', action: { type: String(i + 3), amount: 100 } });
      }

      await until(() => room.snapshotFor(ids[0]!).phase === 'SHOWDOWN', 10_000);
      expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);
    }

    room.dispose();
  }, 30_000);

  // BUG-01: the room builds a fresh RedPacketGame every round with the SAME config.id as roomId.
  // Before the fix that made FC's per-round roundId collide across rounds — a repeat FC treats as an
  // already-applied settlement (idempotency key), replaying chips silently instead of moving new ones.
  it('sends a different roundId to FC on each of two consecutive rounds', async () => {
    const players = new DevPlayers({ startingChips: 50_000 });
    const { fc, roundIds } = recordingFc();
    const ids = [players.create('A').id, players.create('B').id, players.create('C').id];

    const room = new RedPacketRoom(
      {
        id: 'red-packet-roundid',
        name: 'Test Red Packet',
        game: 'red-packet',
        size: 25,
        mineCount: 5,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 8,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc },
    );

    for (const [i, id] of ids.entries()) {
      await room.command(id, { kind: 'sit', seat: i, buyIn: BUY_IN });
    }

    for (let round = 0; round < 2; round++) {
      const target = round + 1;
      await until(() => {
        const s = room.snapshotFor(ids[0]!);
        return s.handNumber === target && s.phase === 'IN_HAND';
      }, 10_000);

      const banker = room.snapshotFor(ids[0]!).seats.find((s) => s.isDealer)?.playerId;
      for (const [i, id] of ids.entries()) {
        if (id === banker) continue;
        await room.command(id, { kind: 'act', action: { type: String(i + 3), amount: 100 } });
      }

      await until(() => room.snapshotFor(ids[0]!).phase === 'SHOWDOWN', 10_000);
    }

    expect(roundIds).toHaveLength(2);
    expect(roundIds[0]).not.toBe(roundIds[1]);

    room.dispose();
  }, 30_000);
});

/**
 * BUG-20 follow-up: `fc.settleTableHand` can throw even after FC already committed it — a lost
 * response, not a refusal. `seat.stack` (the room's own mirror) must equal `players.locked` (the
 * ledger's real record) after settlement either way. But red-packet has two more things a recovered
 * round used to lose: `this.game.reveal()` is gated on the game's state machine reaching RESOLVED,
 * which pre-fix never happened on a recovered round — so the mines stayed withheld from the felt AND
 * the jackpot draw was skipped ("no verifiable seed") instead of running on the round's real one.
 */
describe('RedPacketRoom — settlement recovery from a lost response (BUG-20)', () => {
  it('mirrors stacks, reveals the mines, and draws the jackpot once FC confirms a lost settlement actually committed', async () => {
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

    const room = new RedPacketRoom(
      {
        id: 'red-packet-bug20',
        name: 'Test Red Packet',
        game: 'red-packet',
        size: 25,
        mineCount: 5,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 8,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    let jackpotCalls = 0;
    let jackpotSeed: unknown;
    const realProcessJackpot = (room as unknown as { processJackpot: (...a: unknown[]) => Promise<void> })
      .processJackpot.bind(room);
    (room as unknown as { processJackpot: (...a: unknown[]) => Promise<void> }).processJackpot = async (
      ...args: unknown[]
    ): Promise<void> => {
      jackpotCalls += 1;
      jackpotSeed = args[2];
      return realProcessJackpot(...args);
    };

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Seat 0 (alice) banks the round; bob bets on cell 7.
    await room.command(bob, { kind: 'act', action: { type: '7', amount: 100 } });
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);

    // Conserved AND correctly mirrored, same as baccarat/niu-niu/san-zhang's BUG-20 tests.
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);
    for (const seat of room.snapshotFor(alice).seats) {
      if (!seat.playerId) continue;
      expect(seat.stack).toBe(players.locked(seat.playerId));
    }

    // The provably-fair reveal is no longer withheld: `mines` is only present in `gameState` once
    // `this.game.reveal()` returns non-null, which needs the game's own state machine to have
    // reached RESOLVED — pre-fix, a recovered round's `start()` threw before that transition ran.
    const gameState = room.snapshotFor(alice).gameState as { mines?: number[] };
    expect(gameState.mines).toBeDefined();
    expect(Array.isArray(gameState.mines)).toBe(true);

    // ...and the jackpot draws on that same real seed instead of being skipped for lack of one.
    expect(jackpotCalls).toBe(1);
    expect(typeof jackpotSeed).toBe('string');
    expect(jackpotSeed).toBeTruthy();

    // Recovered all the way through: the game's own state machine reached RESOLVED too.
    expect((room as unknown as { game: { state: string } }).game.state).toBe('RESOLVED');

    room.dispose();
  }, 15_000);
});
