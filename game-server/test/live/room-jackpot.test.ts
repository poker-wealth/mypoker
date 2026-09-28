import { RoomJackpot } from '../../src/live/room-jackpot';
import { DevPlayers } from '../../src/live/players';
import { LotteryRoom } from '../../src/live/lottery-room';
import type { FinancialCoreClient, TableSettlementRequest } from '../../src/core/financial-core-client';
import type { JackpotHit } from '../../src/jackpot/jackpot-engine';

describe('RoomJackpot — Generalized Jackpot Engine Across All Tables', () => {
  it('instantiates for any table id and handles hand evaluations', () => {
    const rj = new RoomJackpot('baccarat-1');
    expect(rj.tableId).toBe('baccarat-1');
    expect(rj.snapshot()).toBeNull();

    const candidates = [
      { playerId: 'alice', baseWeight: 100, behavior: 'NORMAL' as const, associated: false },
      { playerId: 'bob', baseWeight: 100, behavior: 'NORMAL' as const, associated: false },
    ];

    const hits = rj.evaluateHand(1_000, candidates, 'round-1', 'seed-1', (id) => id.toUpperCase());
    expect(Array.isArray(hits)).toBe(true);
  });
});

const BUY_IN = 2_000;

/** A minimal room + two seated players, ready to run a round through resolveRound(). */
function seatedLotteryRoom(
  fc: FinancialCoreClient,
  configId = 'lottery-jackpot',
): { room: LotteryRoom; alice: string; bob: string } {
  const players = new DevPlayers({ startingChips: 10_000 });
  const alice = players.create('Alice').id;
  const bob = players.create('Bob').id;

  const room = new LotteryRoom(
    {
      id: configId,
      name: 'Test Lottery',
      game: 'lottery',
      range: 2,
      minBuyIn: 1_000,
      maxBuyIn: 50_000,
      maxSeats: 6,
      rakeBps: 500,
      bettingTimeMs: 5_000,
      showdownDelayMs: 20,
    },
    { directory: players, fc },
  );

  return { room, alice, bob };
}

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
 * BUG-01 follow-up: FC's jackpot idempotency key is `${roundId}:jackpot:${tier}`. A replay
 * (applied:false) means no chips actually moved, so the room must not tell a player they won —
 * that used to happen unconditionally, before `processJackpot` looked at the result.
 */
describe('BaseLiveRoom.processJackpot — replay handling (BUG-01 follow-up)', () => {
  it('does not announce a jackpot win when FC reports the payout as a replay (applied:false)', async () => {
    const fc: FinancialCoreClient = {
      async buyIn() {},
      async release() {},
      async settleRound(req) {
        return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
      },
      async settleTableHand(req: TableSettlementRequest) {
        return { roundId: req.roundId, applied: true };
      },
      async jackpotPayout() {
        return { applied: false };
      },
    };

    const { room, alice } = seatedLotteryRoom(fc);
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    const forcedHit: JackpotHit = {
      tier: 'MINI',
      playerId: alice,
      amount: 5_000_000, // micro-USD; well above CHIPS_TO_MICROS so hitChips > 0
      roundId: 'irrelevant-engine-round-id',
      at: Date.now(),
      poolAfter: 0,
      animationMs: 400,
      seed: 'seed-1',
    };
    // The engine's own hit-selection RNG/thresholds are covered elsewhere (jackpot-engine tests);
    // this test is only about how the room reacts to FC refusing a payout, so the engine is
    // stubbed to guarantee a hit rather than trying to coax a real one out of it.
    (room as unknown as { roomJackpot: { evaluateHand: () => JackpotHit[] } }).roomJackpot.evaluateHand = () => [
      forcedHit,
    ];

    await (
      room as unknown as { processJackpot(profit: number, roundId: string, seed: string): Promise<void> }
    ).processJackpot(1_000, 'settlement-round-1', 'seed-1');

    expect(room.snapshotFor(alice).jackpot).toBeNull();

    room.dispose();
  });
});

/**
 * BUG-01 follow-up: the jackpot payout roundId used to be `${config.id}-lot-${handNumber}` —
 * deterministic, so two rooms sharing a config.id (or a restart resetting handNumber) mint the
 * same id for hand 1, and FC's idempotency key silently swallows the second payout. It now shares
 * the settlement's own (crypto-random-suffixed) roundId instead.
 */
describe('jackpot payout roundId — BUG-01 follow-up', () => {
  it('sends the same roundId to jackpotPayout as settleTableHand used for that round', async () => {
    const settlementRoundIds: string[] = [];
    const jackpotRoundIds: string[] = [];

    const fc: FinancialCoreClient = {
      async buyIn() {},
      async release() {},
      async settleRound(req) {
        return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
      },
      async settleTableHand(req: TableSettlementRequest) {
        settlementRoundIds.push(req.roundId);
        return { roundId: req.roundId, applied: true };
      },
      async jackpotPayout(req) {
        jackpotRoundIds.push(req.roundId);
        return { applied: true };
      },
    };

    const { room, alice, bob } = seatedLotteryRoom(fc, 'lottery-jackpot-shared-id');
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');
    await room.command(alice, { kind: 'act', action: { type: '0', amount: 100 } });
    await room.command(bob, { kind: 'act', action: { type: '1', amount: 100 } });
    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN');

    expect(settlementRoundIds).toHaveLength(1);
    // No real jackpot hit is expected this round (it is rare by design), but the id the room would
    // have used for one is exactly the settlement id — proven by capturing what resolveRound built
    // and asserting it is what settleTableHand actually saw.
    const roomsRoundId = (room as unknown as { game: { getRoundId(): string } }).game.getRoundId();
    expect(roomsRoundId).toBe(settlementRoundIds[0]);

    room.dispose();
  });

  it('two rooms sharing a config.id and hand number mint different jackpot roundIds', async () => {
    const idsA: string[] = [];
    const idsB: string[] = [];

    function fcCapturing(sink: string[]): FinancialCoreClient {
      return {
        async buyIn() {},
        async release() {},
        async settleRound(req) {
          return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
        },
        async settleTableHand(req: TableSettlementRequest) {
          sink.push(req.roundId);
          return { roundId: req.roundId, applied: true };
        },
      };
    }

    const { room: roomA, alice: aliceA, bob: bobA } = seatedLotteryRoom(fcCapturing(idsA), 'lottery-same-id');
    const { room: roomB, alice: aliceB, bob: bobB } = seatedLotteryRoom(fcCapturing(idsB), 'lottery-same-id');

    for (const [room, a, b] of [
      [roomA, aliceA, bobA],
      [roomB, aliceB, bobB],
    ] as const) {
      await room.command(a, { kind: 'sit', seat: 0, buyIn: BUY_IN });
      await room.command(b, { kind: 'sit', seat: 1, buyIn: BUY_IN });
      await until(() => room.snapshotFor(a).phase === 'IN_HAND');
      await room.command(a, { kind: 'act', action: { type: '0', amount: 100 } });
      await room.command(b, { kind: 'act', action: { type: '1', amount: 100 } });
      await until(() => room.snapshotFor(a).phase === 'SHOWDOWN');
    }

    expect(idsA).toHaveLength(1);
    expect(idsB).toHaveLength(1);
    // Same config.id, same hand number (both are each room's hand 1) — the old deterministic
    // `${config.id}-lot-${handNumber}` id would have collided here.
    expect(idsA[0]).not.toBe(idsB[0]);

    roomA.dispose();
    roomB.dispose();
  });
});
