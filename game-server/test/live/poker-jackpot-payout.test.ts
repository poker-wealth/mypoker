import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';
import { ChipDenominatedFc } from '../../src/live/fc-chip-adapter';
import { usdtToChips } from '../../src/live/chip-currency';
import type { JackpotEngine, JackpotHit } from '../../src/jackpot/index';
import type {
  FinancialCoreClient,
  JackpotPayoutRequest,
  TableSettlementRequest,
} from '../../src/core/financial-core-client';

/**
 * BUG-04: the chip rail's real-money boundary (`ChipDenominatedFc` → `chip-currency.parseChips`)
 * only accepts whole-chip decimal strings (`/^\d+$/`). `evaluateJackpots` used to send
 * `amountChips.toFixed(6)` — e.g. "12.500000" — which throws there, so every poker jackpot payout
 * was refused and no poker jackpot could ever pay. The dev `ChipBank` fake hid this because it
 * parses amounts with `Number()`, which accepts a decimal string just fine.
 *
 * These tests run `PokerRoom` against the REAL `ChipDenominatedFc` adapter (not `ChipBank`) so the
 * real regex gate is actually exercised, the way production wiring (`mount.ts`) does it.
 */

const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  actionTimeoutMs: 80,
  disconnectGraceMs: 20,
  spectatorDelayMs: 0,
};

const BUY_IN = 2_000;

const wait = (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for the table to reach the expected state');
}

/** A jackpot engine stub that forces exactly one hit, however the caller wants it shaped. */
function stubEngine(hit: JackpotHit | null): JackpotEngine {
  return {
    inject: () => {},
    isFrozen: () => false,
    triggersLastHour: () => 0,
    onRoundSettled: () => (hit ? [hit] : []),
  } as unknown as JackpotEngine;
}

interface Harness {
  room: PokerRoom;
  players: DevPlayers;
  alice: string;
  bob: string;
  /** Raw, pre-conversion requests PokerRoom itself built — recorded ahead of ChipDenominatedFc's
   *  internal chips→USDT conversion, so `.amount` is exactly the chip string evaluateJackpots sent. */
  jackpotCalls: JackpotPayoutRequest[];
}

/**
 * Wraps the real `ChipDenominatedFc` (production's adapter) around a minimal recording inner
 * client, so the test exercises the actual `/^\d+$/` gate instead of a dev fake that would let a
 * fractional amount through silently.
 */
function harness(): Harness {
  const players = new DevPlayers({ startingChips: 10_000 });
  const alice = players.create('Alice').id;
  const bob = players.create('Bob').id;
  const jackpotCalls: JackpotPayoutRequest[] = [];

  const inner: FinancialCoreClient = {
    async buyIn(playerAccountId, amount) {
      players.lock(playerAccountId, usdtToChips(amount));
    },
    async release(playerAccountId, amount) {
      players.unlock(playerAccountId, usdtToChips(amount));
    },
    async settleRound(req) {
      return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
    },
    async settleTableHand(req: TableSettlementRequest) {
      return { roundId: req.roundId, applied: true };
    },
    async jackpotPayout() {
      return { applied: true };
    },
  };
  const adapter = new ChipDenominatedFc(inner);
  // Record the RAW chip-denominated request PokerRoom built, before the adapter converts it — this
  // is the exact string that used to be `amountChips.toFixed(6)` and threw inside the adapter's
  // `chipsToUsdt`. Recording happens before delegating, so a throw from the adapter is still visible
  // to the assertions below as "a call happened but the room caught an error", not as a silent gap.
  const fc: FinancialCoreClient = {
    buyIn: (playerAccountId, amount, scope) => adapter.buyIn(playerAccountId, amount, scope),
    release: (playerAccountId, amount, scope) => adapter.release(playerAccountId, amount, scope),
    settleRound: (req) => adapter.settleRound(req),
    settleTableHand: (req) => adapter.settleTableHand(req),
    jackpotPayout: (req: JackpotPayoutRequest) => {
      jackpotCalls.push(req);
      return adapter.jackpotPayout(req);
    },
  };

  const room = new PokerRoom({ ...FAST, id: 'jackpot-payout-t1', name: 'Test table' } as PokerRoomConfig, {
    directory: players,
    fc,
  });
  return { room, players, alice, bob, jackpotCalls };
}

async function seatBoth(h: Harness): Promise<void> {
  await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
  await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
  await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
}

async function playToShowdown(h: Harness): Promise<void> {
  const seatOf: Record<number, string> = { 0: h.alice, 1: h.bob };
  for (let guard = 0; guard < 200; guard++) {
    const view = h.room.snapshotFor(h.alice);
    if (view.phase !== 'IN_HAND' || view.toActSeat === null) return;
    const playerId = seatOf[view.toActSeat]!;
    const legal = h.room.snapshotFor(playerId).legal!;
    await h.room.command(playerId, { kind: 'act', action: legal.canCheck ? { type: 'check' } : { type: 'call' } });
  }
  throw new Error('hand did not finish');
}

describe('PokerRoom jackpot payouts use whole chips (BUG-04)', () => {
  it('floors a fractional hit to whole chips and pays it through the real chip rail', async () => {
    const h = harness();
    const forcedHit: JackpotHit = {
      tier: 'MINI',
      playerId: h.alice,
      amount: 12_500_000, // micro-USD: 12.5 chips at CHIPS_TO_MICROS=1_000_000 — the exact fractional case
      roundId: 'engine-round-irrelevant',
      at: Date.now(),
      poolAfter: 0,
      animationMs: 400,
      seed: 'seed-1',
    };
    (h.room as unknown as { jackpotEngine: JackpotEngine }).jackpotEngine = stubEngine(forcedHit);

    await seatBoth(h);
    await playToShowdown(h);
    await until(() => h.room.snapshotFor(h.alice).phase === 'SHOWDOWN');

    // The request PokerRoom itself built — this is what the old `.toFixed(6)` code sent, and what
    // the real chip rail (`chip-currency.parseChips`) demands be `/^\d+$/`.
    expect(h.jackpotCalls).toHaveLength(1);
    expect(h.jackpotCalls[0]!.amount).toMatch(/^\d+$/);
    expect(h.jackpotCalls[0]!.amount).toBe('12'); // floor(12.5), not "12.500000"

    // Paid AND announced with the same floored amount — no re-derivation drift between the two.
    const snap = h.room.snapshotFor(h.alice);
    expect(snap.jackpot).not.toBeNull();
    expect(snap.jackpot!.tier).toBe('MINI');
    expect(snap.jackpot!.amount).toBe(12);
    h.room.dispose();
  });

  it('skips a hit that floors to zero chips instead of paying nothing', async () => {
    const h = harness();
    const forcedHit: JackpotHit = {
      tier: 'MINI',
      playerId: h.alice,
      amount: 400_000, // 0.4 chips — floors to 0
      roundId: 'engine-round-irrelevant',
      at: Date.now(),
      poolAfter: 0,
      animationMs: 400,
      seed: 'seed-1',
    };
    (h.room as unknown as { jackpotEngine: JackpotEngine }).jackpotEngine = stubEngine(forcedHit);

    await seatBoth(h);
    await playToShowdown(h);
    await until(() => h.room.snapshotFor(h.alice).phase === 'SHOWDOWN');

    expect(h.jackpotCalls).toHaveLength(0);
    expect(h.room.snapshotFor(h.alice).jackpot).toBeNull();
    h.room.dispose();
  });
});
