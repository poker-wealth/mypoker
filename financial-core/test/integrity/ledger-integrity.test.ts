import { Decimal128 } from 'bson';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SettlementModel } from '../../src/settlement/settlement.model';
import { settleTableHand } from '../../src/settlement/table-settlement';
import { TableType } from '../../src/settlement/settlement-domain';
import { Money } from '../../src/domain/money';
import { AccountType, LedgerDirection } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * 100-HAND LEDGER-INTEGRITY RUN (plan Day 15 — "zero discrepancy, conservation across all games").
 *
 * Drives the REAL settlement path (settleTableHand → transfer() → double-entry ledger) for 100
 * multi-party hands of varied shape, and holds it to three invariants that must ALL be true or the
 * platform is either printing or losing money:
 *
 *   1. ZERO DISCREPANCY — an independent expected-balance model (kept here in integer micros) matches
 *      the ledger's real balances account-by-account after all 100 hands. Not "close": equal.
 *   2. DOUBLE-ENTRY — Σ(DEBIT) === Σ(CREDIT) across every ledger row ever written.
 *   3. CONSERVATION — the total money across every account (available + locked + clearing) is exactly
 *      what we started with. Rake and jackpot move to house/pool accounts but never leave the system.
 *
 * Deterministic (seeded LCG) so a failure reproduces exactly. Amounts are computed in micros with
 * integer floor-division and the remainder absorbed into the winners' share, so each hand balances to
 * the micro with no rounding drift — the ledger is then checked against that exact expectation.
 */

const PLAYERS = 8;
const HANDS = 100;
// A large starting locked stake per player so 100 hands of modest amounts never overdraw a loser.
const START_LOCKED = Money.fromDecimalString('1000000').toMicros(); // 1,000,000.000000

const RAKE_BPS = 500n; // 5%
const JACKPOT_BPS = 50n; // 0.5%

/** Deterministic PRNG — a reproducible run means a reproducible failure. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Bal {
  available: bigint;
  locked: bigint;
  clearing: bigint;
}

describe('ledger integrity — 100 hands, zero discrepancy + conservation', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel, LedgerModel, SettlementModel);
  });
  afterAll(stopTestDb);
  afterEach(clearCollections);

  it('applies 100 varied real settlements with no money created or destroyed', async () => {
    // ── Setup: funded players (locked stake), the treasury, and one table's four jackpot pools. ──
    const players: string[] = [];
    const expected = new Map<string, Bal>();

    for (let i = 0; i < PLAYERS; i++) {
      const a = await AccountModel.create({
        accountType: AccountType.PLAYER,
        ownerId: `integrity-p${i}`,
        lockedBalance: Decimal128.fromString(Money.fromMicros(START_LOCKED).toString()),
      });
      players.push(a._id);
      expected.set(a._id, { available: 0n, locked: START_LOCKED, clearing: 0n });
    }

    const treasury = await AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' });
    expected.set(treasury._id, { available: 0n, locked: 0n, clearing: 0n });

    const mkPool = async (t: AccountType): Promise<string> => {
      const p = await AccountModel.create({ accountType: t, ownerId: 'integrity-table' });
      expected.set(p._id, { available: 0n, locked: 0n, clearing: 0n });
      return p._id;
    };
    const pools = {
      mini: await mkPool(AccountType.JACKPOT_MINI),
      minor: await mkPool(AccountType.JACKPOT_MINOR),
      major: await mkPool(AccountType.JACKPOT_MAJOR),
      grand: await mkPool(AccountType.JACKPOT_GRAND),
    };

    const totalAtStart = BigInt(PLAYERS) * START_LOCKED;
    const rng = lcg(0xc0ffee);

    // ── Run 100 hands. ──
    let lastReq: Parameters<typeof settleTableHand>[0] | undefined;
    for (let h = 0; h < HANDS; h++) {
      // Choose distinct losers (2–3) and winners (1–2) from players with enough locked to cover a loss.
      const order = [...players].sort(() => (rng() < 0.5 ? -1 : 1));
      const nLosers = 2 + (rng() < 0.5 ? 0 : 1);
      const nWinners = 1 + (rng() < 0.5 ? 0 : 1);
      const chosen = order.slice(0, nLosers + nWinners);
      const loserIds = chosen.slice(0, nLosers);
      const winnerIds = chosen.slice(nLosers, nLosers + nWinners);

      // Each loser stakes 50–500 units (in micros); skip any that somehow lacks the locked funds.
      const losers = loserIds.map((id) => {
        const amount = BigInt(50 + Math.floor(rng() * 450)) * 1_000_000n;
        return { id, amount };
      });
      const pot = losers.reduce((s, l) => s + l.amount, 0n);
      if (losers.some((l) => expected.get(l.id)!.locked < l.amount)) continue; // headroom guard

      const rake = (pot * RAKE_BPS) / 10_000n; // floor
      const jackpotTotal = (pot * JACKPOT_BPS) / 10_000n; // floor
      const jMini = (jackpotTotal * 20n) / 100n;
      const jMinor = (jackpotTotal * 30n) / 100n;
      const jMajor = (jackpotTotal * 25n) / 100n;
      const jGrand = jackpotTotal - jMini - jMinor - jMajor; // remainder → grand
      const winnersTotal = pot - rake - jackpotTotal; // remainder-absorbing: keeps the hand exact

      // Split the winners' pot; first winner absorbs the division remainder.
      const share = winnersTotal / BigInt(winnerIds.length);
      const winners = winnerIds.map((id, idx) => ({
        id,
        amount: idx === 0 ? winnersTotal - share * BigInt(winnerIds.length - 1) : share,
      }));

      const req = {
        roundId: `integrity-h${h}`,
        tableType: TableType.PLATFORM,
        losers: losers.map((l) => ({ accountId: l.id, amount: Money.fromMicros(l.amount) })),
        winners: winners.map((w) => ({ accountId: w.id, amount: Money.fromMicros(w.amount) })),
        rake: Money.fromMicros(rake),
        jackpot: {
          mini: Money.fromMicros(jMini),
          minor: Money.fromMicros(jMinor),
          major: Money.fromMicros(jMajor),
          grand: Money.fromMicros(jGrand),
        },
        jackpotAccounts: pools,
      };
      const res = await settleTableHand(req);
      expect(res.applied).toBe(true);
      lastReq = req;

      // Mirror the movement into the independent expected model.
      for (const l of losers) expected.get(l.id)!.locked -= l.amount;
      for (const w of winners) expected.get(w.id)!.locked += w.amount;
      expected.get(treasury._id)!.available += rake;
      expected.get(pools.mini)!.available += jMini;
      expected.get(pools.minor)!.available += jMinor;
      expected.get(pools.major)!.available += jMajor;
      expected.get(pools.grand)!.available += jGrand;
    }

    // ── Invariant 1: ZERO DISCREPANCY — real ledger balances equal the expected model, exactly. ──
    let realTotal = 0n;
    for (const [id, exp] of expected) {
      const acc = await AccountModel.findById(id);
      const av = Money.fromDecimal128(acc!.availableBalance).toMicros();
      const lo = Money.fromDecimal128(acc!.lockedBalance).toMicros();
      const cl = Money.fromDecimal128(acc!.clearingBalance).toMicros();
      expect({ id, available: av, locked: lo, clearing: cl }).toEqual({
        id,
        available: exp.available,
        locked: exp.locked,
        clearing: exp.clearing,
      });
      realTotal += av + lo + cl;
    }

    // ── Invariant 2: DOUBLE-ENTRY — Σ(DEBIT) === Σ(CREDIT) across all ledger rows. ──
    const agg = await LedgerModel.aggregate<{ _id: LedgerDirection; total: Decimal128 }>([
      { $group: { _id: '$direction', total: { $sum: '$amount' } } },
    ]);
    const byDir = Object.fromEntries(agg.map((r) => [r._id, r.total.toString()]));
    expect(byDir[LedgerDirection.DEBIT]).toBe(byDir[LedgerDirection.CREDIT]);

    // ── Invariant 3: CONSERVATION — not a micro created or destroyed. ──
    expect(realTotal).toBe(totalAtStart);

    // ── Bonus: idempotency holds at volume — replaying the last hand changes nothing. ──
    expect(lastReq).toBeDefined();
    const replay = await settleTableHand(lastReq!);
    expect(replay.applied).toBe(false);
    let afterReplay = 0n;
    for (const id of expected.keys()) {
      const acc = await AccountModel.findById(id);
      afterReplay +=
        Money.fromDecimal128(acc!.availableBalance).toMicros() +
        Money.fromDecimal128(acc!.lockedBalance).toMicros() +
        Money.fromDecimal128(acc!.clearingBalance).toMicros();
    }
    expect(afterReplay).toBe(totalAtStart);
  }, 60_000);
});
