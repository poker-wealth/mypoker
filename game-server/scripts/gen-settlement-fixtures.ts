import { settleNet } from '../src/games/texas/settlement';

/**
 * Regenerate the settlement regression fixtures (SAMUEL.md task 5).
 *
 *   npx ts-node scripts/gen-settlement-fixtures.ts > \
 *     test/games/__fixtures__/settlement-cases.json
 *
 * `settleNet` is the single most shared money function here — nine games call
 * it — and its largest-remainder allocation is precisely where chips go missing
 * without anyone noticing. These fixtures pin its OUTPUT so a change to the
 * arithmetic fails loudly instead of quietly redistributing money.
 *
 * Generated from the real function, never hand-written: a hand-written
 * expectation only proves the code agrees with whoever typed it. Regenerate
 * this file when behaviour legitimately changes — and when you do, read the
 * diff, because every changed line is money moving somewhere else.
 *
 * Pinning is not the same as proving correct. The fixtures catch CHANGE; the
 * conservation invariant asserted in the test catches WRONGNESS. Both are
 * needed, and neither substitutes for the other.
 */

interface Case {
  name: string;
  why: string;
  nets: Record<string, number>;
  rakeBps: number;
  jackpotBps?: number;
}

const CASES: Case[] = [
  {
    name: 'heads-up, even',
    why: 'The simplest shape. If this drifts, everything has.',
    nets: { winner: 1000, loser: -1000 },
    rakeBps: 500,
  },
  {
    name: 'three-way, one winner',
    why: "Dou Di Zhu's landlord shape: one player against two.",
    nets: { landlord: 400, peasantA: -200, peasantB: -200 },
    rakeBps: 0,
  },
  {
    name: 'two winners, uneven',
    why: 'Rake and jackpot must be split BETWEEN winners in proportion, not charged twice.',
    nets: { big: 900, small: 100, loser: -1000 },
    rakeBps: 500,
  },
  {
    name: 'remainder that does not divide',
    why:
      'Three winners sharing a deduction of 1 chip. Largest-remainder must hand ' +
      'the odd chip to exactly one of them — never drop it, never invent a second.',
    nets: { a: 334, b: 333, c: 333, loser: -1000 },
    rakeBps: 10,
  },
  {
    name: 'rake rounds to zero',
    why: 'A tiny pot with a real rate. floor() gives 0, and 0 must not become 1.',
    nets: { winner: 3, loser: -3 },
    rakeBps: 500,
  },
  {
    name: 'zero rake, jackpot still taken',
    why:
      'The case my own test got wrong: at rakeBps 0, 0.5% still leaves for the ' +
      'jackpot pools, so winners + rake alone does not balance.',
    nets: { winner: 1000, loser: -1000 },
    rakeBps: 0,
  },
  {
    name: 'jackpot disabled',
    why: 'Explicit 0 must actually mean 0 — not fall through to the 50bps default.',
    nets: { winner: 1000, loser: -1000 },
    rakeBps: 500,
    jackpotBps: 0,
  },
  {
    name: 'large pot',
    why: 'Guards against precision loss at a scale a real high-stakes table reaches.',
    nets: { winner: 5_000_000, loser: -3_000_000, loser2: -2_000_000 },
    rakeBps: 500,
  },
  {
    name: 'many small losers',
    why: 'Red Packet / Lottery shape: one winner, a crowd of small contributors.',
    nets: { winner: 900, l1: -100, l2: -100, l3: -100, l4: -100, l5: -100, l6: -100, l7: -100, l8: -100, l9: -100 },
    rakeBps: 250,
  },
  {
    name: 'rake lands exactly on .5',
    why:
      'The floor/round boundary. 5%% of 1010 is 50.5 — floor gives 50, round ' +
      'gives 51. Chosen so a one-character change to the rounding fails here ' +
      'rather than depending on which other case happened to catch it.',
    nets: { winner: 1010, loser: -1010 },
    rakeBps: 500,
    jackpotBps: 0,
  },
  {
    name: 'rake lands just below .5',
    why: 'The other side of the same boundary: 50.4 floors and rounds alike.',
    nets: { winner: 1008, loser: -1008 },
    rakeBps: 500,
    jackpotBps: 0,
  },
  {
    name: 'jackpot lands on a fraction',
    why: 'Same boundary for the jackpot deduction, which uses its own floor().',
    nets: { winner: 1030, loser: -1030 },
    rakeBps: 0,
  },
  {
    name: 'everyone flat',
    why: 'A pushed hand. Nothing to allocate, and nothing should be invented.',
    nets: { a: 0, b: 0 },
    rakeBps: 500,
  },
];

const out = CASES.map((c) => {
  const result = settleNet(
    new Map(Object.entries(c.nets)),
    { rakeBps: c.rakeBps, ...(c.jackpotBps !== undefined ? { jackpotBps: c.jackpotBps } : {}) },
  );
  return {
    ...c,
    expected: {
      losers: result.losers,
      winners: result.winners,
      rake: result.rake,
      jackpotTotal: result.jackpotTotal,
      jackpot: result.jackpot,
    },
  };
});

console.log(JSON.stringify(out, null, 2));
