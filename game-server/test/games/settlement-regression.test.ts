import { settleNet } from '../../src/games/texas/settlement';
import cases from './__fixtures__/settlement-cases.json';

/**
 * Settlement regression fixtures (SAMUEL.md task 5).
 *
 * `settleNet` is the most shared money function in this repo — nine games call
 * it — and its largest-remainder allocation is exactly where chips go missing
 * without anyone noticing. A rounding change here moves real money at every
 * table simultaneously, and no single game's tests would catch it.
 *
 * Two kinds of assertion here, and they do different jobs:
 *
 *   The FIXTURES pin behaviour. They are generated from the real function
 *   (scripts/gen-settlement-fixtures.ts), so they prove only that today's
 *   output matches the day they were generated — which is precisely what
 *   catches an unintended change. They cannot prove the arithmetic is right.
 *
 *   The INVARIANTS prove correctness. Conservation, non-negativity, and the
 *   jackpot split holding together are true regardless of what the fixtures
 *   say, and they would fail even on a freshly regenerated wrong answer.
 *
 * If a fixture fails, do not regenerate it to make the test pass. Read the
 * diff: every changed line is money going somewhere it did not go before.
 */

interface Party {
  playerId: string;
  amount: number;
}

interface FixtureCase {
  name: string;
  why: string;
  nets: Record<string, number>;
  rakeBps: number;
  jackpotBps?: number;
  expected: {
    losers: Party[];
    winners: Party[];
    rake: number;
    jackpotTotal: number;
    jackpot: { mini: number; minor: number; major: number; grand: number };
  };
}

const FIXTURES = cases as FixtureCase[];

const run = (c: FixtureCase): ReturnType<typeof settleNet> =>
  settleNet(new Map(Object.entries(c.nets)), {
    rakeBps: c.rakeBps,
    ...(c.jackpotBps !== undefined ? { jackpotBps: c.jackpotBps } : {}),
  });

describe('settleNet — pinned behaviour', () => {
  it.each(FIXTURES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const actual = run(c);

    // The whole result, not field by field: a change that moved a chip from a
    // winner into the rake would pass three separate assertions and fail this.
    expect({
      losers: actual.losers,
      winners: actual.winners,
      rake: actual.rake,
      jackpotTotal: actual.jackpotTotal,
      jackpot: actual.jackpot,
    }).toEqual(c.expected);
  });
});

describe('settleNet — invariants that hold whatever the fixtures say', () => {
  it.each(FIXTURES.map((c) => [c.name, c] as const))(
    'conserves money: %s',
    (_name, c) => {
      const r = run(c);
      const paidIn = r.losers.reduce((s, l) => s + l.amount, 0);
      const paidOut = r.winners.reduce((s, w) => s + w.amount, 0);

      // The invariant financial-core states on TableSettlementRequest:
      // Σ(losers) = Σ(winners) + rake + Σ(jackpot). These tables are
      // player-funded — the platform adds nothing — so any gap is money created
      // or destroyed, and a gap of one chip per hand is a real leak at volume.
      expect(paidIn).toBe(paidOut + r.rake + r.jackpotTotal);
    },
  );

  it.each(FIXTURES.map((c) => [c.name, c] as const))(
    'never emits a negative or zero party: %s',
    (_name, c) => {
      const r = run(c);
      // A zero-amount party would ask financial-core to move nothing, and a
      // negative one would move it the wrong way.
      for (const p of [...r.losers, ...r.winners]) expect(p.amount).toBeGreaterThan(0);
    },
  );

  it.each(FIXTURES.map((c) => [c.name, c] as const))(
    'splits the jackpot without losing a chip: %s',
    (_name, c) => {
      const r = run(c);
      const split = r.jackpot.mini + r.jackpot.minor + r.jackpot.major + r.jackpot.grand;

      // The four tiers must add back to the total. A rounding gap here is money
      // deducted from a winner that reaches no pool at all.
      expect(split).toBe(r.jackpotTotal);
    },
  );
});

describe('settleNet — the edges the fixtures exist for', () => {
  it('gives an indivisible remainder to exactly one winner', () => {
    // Three winners, a deduction of 1. Largest-remainder must hand that chip to
    // one of them: dropping it destroys money, duplicating it creates money.
    const r = settleNet(
      new Map([
        ['a', 334],
        ['b', 333],
        ['c', 333],
        ['loser', -1000],
      ]),
      { rakeBps: 10, jackpotBps: 0 },
    );

    expect(r.rake).toBe(1);
    const paidOut = r.winners.reduce((s, w) => s + w.amount, 0);
    expect(paidOut).toBe(1000 - 1);
  });

  it('does not round a small rake up into existence', () => {
    // 5% of 3 is 0.15. A player who wins 3 chips must not be charged 1.
    const r = settleNet(new Map([['w', 3], ['l', -3]]), { rakeBps: 500, jackpotBps: 0 });
    expect(r.rake).toBe(0);
    expect(r.winners[0]!.amount).toBe(3);
  });

  it('treats an explicit jackpotBps of 0 as zero, not as the default', () => {
    // `cfg.jackpotBps ?? 50` — a `0` must survive the nullish coalesce. Written
    // with `||` this would silently charge 0.5% forever.
    const off = settleNet(new Map([['w', 1000], ['l', -1000]]), { rakeBps: 0, jackpotBps: 0 });
    const on = settleNet(new Map([['w', 1000], ['l', -1000]]), { rakeBps: 0 });

    expect(off.jackpotTotal).toBe(0);
    expect(on.jackpotTotal).toBeGreaterThan(0);
  });

  it('emits nothing at all for a pushed hand', () => {
    const r = settleNet(new Map([['a', 0], ['b', 0]]), { rakeBps: 500 });
    expect(r.losers).toEqual([]);
    expect(r.winners).toEqual([]);
    expect(r.rake).toBe(0);
    expect(r.jackpotTotal).toBe(0);
  });
});
