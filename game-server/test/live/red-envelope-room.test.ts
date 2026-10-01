import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { RedEnvelopeRoom } from '../../src/live/red-envelope-room';
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

describe('RedEnvelopeRoom — Live Room Integration', () => {
  it('seats two players, resolves a round, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new RedEnvelopeRoom(
      {
        id: 'red-envelope-1',
        name: 'Test Red Envelope',
        game: 'red-packet',
        totalAmount: 500,
        // A single packet means bob's one claim empties the envelope and triggers resolveRound
        // immediately, rather than waiting out claimTimeMs.
        packetCount: 1,
        mineNumber: 5,
        penaltyMultiplier: 2,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 8,
        rakeBps: 500,
        claimTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Alice sat first, so she banks the envelope; bob claims the only packet.
    await room.command(bob, { kind: 'act', action: { type: 'claim' } });
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);

    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);
});

/**
 * BUG-20 follow-up: `fc.settleTableHand` can throw even after FC already committed it — a lost
 * response, not a refusal. `seat.stack` (the room's own mirror) must equal `players.locked` (the
 * ledger's real record) after settlement either way. But red-envelope has two more things a
 * recovered round used to lose: `this.game.reveal()` is gated on the game's state machine reaching
 * RESOLVED, which pre-fix never happened on a recovered round — so the split stayed withheld from
 * the felt AND the jackpot draw was skipped ("no verifiable seed") instead of running on the round's
 * real one.
 */
describe('RedEnvelopeRoom — settlement recovery from a lost response (BUG-20)', () => {
  it('mirrors stacks, reveals the split, and draws the jackpot once FC confirms a lost settlement actually committed', async () => {
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

    const room = new RedEnvelopeRoom(
      {
        id: 'red-envelope-bug20',
        name: 'Test Red Envelope',
        game: 'red-packet',
        totalAmount: 500,
        // A single packet means bob's one claim empties the envelope and triggers resolveRound
        // immediately, rather than waiting out claimTimeMs.
        packetCount: 1,
        mineNumber: 5,
        penaltyMultiplier: 2,
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 8,
        rakeBps: 500,
        claimTimeMs: 5_000,
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

    // Alice sat first, so she banks the envelope; bob claims the only packet, which empties it and
    // resolves the round immediately.
    await room.command(bob, { kind: 'act', action: { type: 'claim' } });
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);

    // Conserved AND correctly mirrored, same as baccarat/niu-niu/san-zhang's BUG-20 tests.
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);
    for (const seat of room.snapshotFor(alice).seats) {
      if (!seat.playerId) continue;
      expect(seat.stack).toBe(players.locked(seat.playerId));
    }

    // The provably-fair reveal is no longer withheld: `serverSeed`/`packets` are only present in
    // `gameState` once `this.game.reveal()` returns non-null, which needs the game's own state
    // machine to have reached RESOLVED — pre-fix, a recovered round's `start()` threw before that
    // transition ran.
    const gameState = room.snapshotFor(alice).gameState as { serverSeed?: string; packets?: number[] };
    expect(gameState.serverSeed).toBeDefined();
    expect(typeof gameState.serverSeed).toBe('string');
    expect(gameState.packets).toBeDefined();
    expect(Array.isArray(gameState.packets)).toBe(true);

    // ...and the jackpot draws on that same real seed instead of being skipped for lack of one.
    expect(jackpotCalls).toBe(1);
    expect(typeof jackpotSeed).toBe('string');
    expect(jackpotSeed).toBeTruthy();

    // Recovered all the way through: the game's own state machine reached RESOLVED too.
    expect((room as unknown as { game: { state: string } }).game.state).toBe('RESOLVED');

    room.dispose();
  }, 15_000);
});
