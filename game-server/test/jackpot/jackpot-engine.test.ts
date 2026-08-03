import { JackpotEngine, CB3_MAX_HITS } from '../../src/jackpot/jackpot-engine';
import { injectionFor, splitInjection, usd, TIER_CONFIG } from '../../src/jackpot/tiers';
import { grandWindow, isInGrandWindow, grandTriggerAt, zoned } from '../../src/jackpot/schedule';
import { drawWinner, weightOf, type JackpotCandidate } from '../../src/jackpot/weights';

const player = (id: string, over: Partial<JackpotCandidate> = {}): JackpotCandidate => ({
  playerId: id,
  baseWeight: 10,
  behavior: 'NORMAL',
  associated: false,
  ...over,
});
const TABLE = [player('a'), player('b'), player('c')];

/** A Saturday inside the window: 2026-07-18 19:00 UTC+8 → 11:00 UTC. */
const SAT_IN_WINDOW = Date.UTC(2026, 6, 18, 11, 0, 0);
/** The same Saturday, but 09:00 UTC+8 — before the window opens. */
const SAT_BEFORE_WINDOW = Date.UTC(2026, 6, 18, 1, 0, 0);
/** A Wednesday. */
const WEDNESDAY = Date.UTC(2026, 6, 15, 11, 0, 0);

const ctx = (over: Partial<Parameters<JackpotEngine['onRoundSettled']>[0]> = {}) => ({
  roundId: 'r1',
  seed: 'seed-1',
  now: WEDNESDAY,
  candidates: TABLE,
  ...over,
});

describe('injection — winners only', () => {
  it('takes 0.5% of the winner’s profit', () => {
    expect(injectionFor(usd(100))).toBe(usd(0.5));
  });

  it('a loser contributes NOTHING', () => {
    expect(injectionFor(-usd(100))).toBe(0);
    expect(injectionFor(0)).toBe(0);
  });

  it('splits 20/30/25/25, summing to exactly the injection', () => {
    const s = splitInjection(1000);
    expect(s).toEqual({ MINI: 200, MINOR: 300, MAJOR: 250, GRAND: 250 });
    expect(s.MINI + s.MINOR + s.MAJOR + s.GRAND).toBe(1000);
  });

  it('leaves no dust — odd amounts still sum exactly', () => {
    for (const total of [1, 7, 33, 999, 12_345]) {
      const s = splitInjection(total);
      expect(s.MINI + s.MINOR + s.MAJOR + s.GRAND).toBe(total);
    }
  });

  it('feeds the table’s pools', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(1000)); // → $5 injected
    expect(e.totalPool()).toBe(usd(5));
    expect(e.pool('MINI')).toBe(usd(1)); // 20%
    expect(e.pool('GRAND')).toBe(usd(1.25)); // 25%
  });
});

describe('minimum threshold — skip, never subsidise', () => {
  it('a due tier with an underfunded pool pays nothing, and STAYS due', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(100)); // only $0.50 in total — Mini is far below its $10 minimum

    // Run well past Mini's 25–35 round interval.
    let hits = 0;
    for (let i = 0; i < 40; i++) hits += e.onRoundSettled(ctx({ roundId: `r${i}` })).length;
    expect(hits).toBe(0);
    expect(e.skipHistory().some((s) => s.reason === 'BELOW_THRESHOLD')).toBe(true);
    expect(e.pool('MINI')).toBeGreaterThan(0); // pool untouched, no platform subsidy

    // Fund it properly — the tier is still due, so it fires on the very next round.
    e.inject(usd(20_000)); // Mini now well over $10
    const hit = e.onRoundSettled(ctx({ roundId: 'funded' }))[0];
    expect(hit?.tier).toBe('MINI');
  });

  it('pays exactly the tier’s share of the pool', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(20_000)); // Mini pool = 20% of 0.5% of 20k = $20
    const before = e.pool('MINI');
    let hit;
    for (let i = 0; i < 40 && !hit; i++) hit = e.onRoundSettled(ctx({ roundId: `r${i}` }))[0];
    expect(hit!.amount).toBe(Math.floor((before * TIER_CONFIG.MINI.payoutBps) / 10000)); // 5%
    expect(e.pool('MINI')).toBe(before - hit!.amount);
  });
});

describe('Mini/Minor cadence is drawn from the seed', () => {
  it('fires inside the 25–35 round band, not on a fixed round', () => {
    const rounds: number[] = [];
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const e = new JackpotEngine('t1');
      e.inject(usd(50_000));
      for (let i = 1; i <= 40; i++) {
        const hits = e.onRoundSettled(ctx({ roundId: `r${i}`, seed }));
        if (hits.some((h) => h.tier === 'MINI')) {
          rounds.push(i);
          break;
        }
      }
    }
    expect(rounds).toHaveLength(5);
    for (const r of rounds) {
      expect(r).toBeGreaterThanOrEqual(25);
      expect(r).toBeLessThanOrEqual(35);
    }
    expect(new Set(rounds).size).toBeGreaterThan(1); // not a fixed round — genuinely varies
  });
});

describe('Grand — the three-condition gate', () => {
  const grandCtx = (over = {}) => ctx({ seed: 'grand-seed', now: SAT_IN_WINDOW, ...over });

  it('the Saturday window is 18:00–23:00 UTC+8', () => {
    expect(isInGrandWindow(SAT_IN_WINDOW)).toBe(true); // 19:00 Sat
    expect(isInGrandWindow(SAT_BEFORE_WINDOW)).toBe(false); // 09:00 Sat
    expect(isInGrandWindow(WEDNESDAY)).toBe(false); // not Saturday at all
  });

  it('never fires outside the window, however big the pool', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(1_000_000)); // Grand pool far over $1,000
    for (let i = 0; i < 50; i++) {
      const hits = e.onRoundSettled(ctx({ roundId: `r${i}`, now: WEDNESDAY }));
      expect(hits.some((h) => h.tier === 'GRAND')).toBe(false);
    }
  });

  it('does not fire with an underfunded pool even inside the window', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(100)); // Grand pool ≪ $1,000
    const hits = e.onRoundSettled(grandCtx({ now: laterInWindow('grand-seed') }));
    expect(hits.some((h) => h.tier === 'GRAND')).toBe(false);
    expect(e.skipHistory().some((s) => s.tier === 'GRAND' && s.reason === 'BELOW_THRESHOLD')).toBe(true);
  });

  it('does not fire with nobody at the table', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(1_000_000));
    const hits = e.onRoundSettled(
      grandCtx({ now: laterInWindow('grand-seed'), candidates: [] }),
    );
    expect(hits.some((h) => h.tier === 'GRAND')).toBe(false);
    expect(e.skipHistory().some((s) => s.tier === 'GRAND' && s.reason === 'NO_PLAYERS')).toBe(true);
  });

  it('fires when all three conditions hold at once, paying 70% of the pool', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(1_000_000));
    const pool = e.pool('GRAND');
    const hits = e.onRoundSettled(grandCtx({ now: laterInWindow('grand-seed') }));
    const grand = hits.find((h) => h.tier === 'GRAND');
    expect(grand).toBeDefined();
    expect(grand!.amount).toBe(Math.floor((pool * 7000) / 10000));
    expect(TABLE.map((p) => p.playerId)).toContain(grand!.playerId);
  });

  it('a table frozen during its window misses it entirely', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(1_000_000));
    // Force CB3 to freeze the table first.
    freezeByCB3(e);
    const hits = e.onRoundSettled(grandCtx({ now: laterInWindow('grand-seed') }));
    expect(hits).toHaveLength(0);
    expect(e.isFrozen()).toBe(true);
    expect(e.skipHistory().some((s) => s.reason === 'TABLE_FROZEN')).toBe(true);
  });

  it('the trigger moment is random within the window, and verifiable from the seed', () => {
    const w = grandWindow(SAT_IN_WINDOW);
    const moments = ['a', 'b', 'c', 'd'].map((s) => grandTriggerAt(s, SAT_IN_WINDOW));
    for (const m of moments) {
      expect(m).toBeGreaterThanOrEqual(w.start);
      expect(m).toBeLessThan(w.end);
    }
    expect(new Set(moments).size).toBeGreaterThan(1); // not a fixed time
    // Same seed → same moment: anyone can recompute and check we didn't fire early or late.
    expect(grandTriggerAt('a', SAT_IN_WINDOW)).toBe(moments[0]);
  });
});

describe('anti-arbitrage weighting', () => {
  it('a confirmed colluder has ZERO weight and can never win', () => {
    expect(weightOf(player('x', { behavior: 'COLLUDING' }))).toBe(0);

    const colluders = [player('x', { behavior: 'COLLUDING' }), player('y', { behavior: 'COLLUDING' })];
    expect(drawWinner(colluders, 'any-seed')).toBeNull(); // nobody eligible → pay nobody
  });

  it('flagged players are halved, associated players cut to 30%', () => {
    expect(weightOf(player('n'))).toBe(10 * 100 * 100);
    expect(weightOf(player('f', { behavior: 'FLAGGED' }))).toBe(10 * 50 * 100);
    expect(weightOf(player('a', { associated: true }))).toBe(10 * 100 * 30);
  });

  it('a table of colluders wins nothing — the jackpot is skipped, not handed over', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(50_000));
    const colluders = [player('x', { behavior: 'COLLUDING' }), player('y', { behavior: 'COLLUDING' })];
    let hits = 0;
    for (let i = 0; i < 40; i++) hits += e.onRoundSettled(ctx({ roundId: `r${i}`, candidates: colluders })).length;
    expect(hits).toBe(0);
    expect(e.skipHistory().some((s) => s.reason === 'NO_ELIGIBLE_WINNER')).toBe(true);
  });

  it('the draw is reproducible from the seed — we cannot hand-pick a winner', () => {
    const a = drawWinner(TABLE, 'seed-z');
    const b = drawWinner(TABLE, 'seed-z');
    expect(a!.playerId).toBe(b!.playerId);
  });

  it('over many seeds, weight actually decides — the heavy player wins most', () => {
    const cands = [player('heavy', { baseWeight: 90 }), player('light', { baseWeight: 10 })];
    let heavy = 0;
    for (let i = 0; i < 500; i++) if (drawWinner(cands, `s${i}`)!.playerId === 'heavy') heavy++;
    expect(heavy).toBeGreaterThan(400); // ≈90%
    expect(heavy).toBeLessThan(500);
  });
});

describe('CB3 — three hits in an hour freezes the table', () => {
  it('freezes after three jackpots inside one hour, and stops paying', () => {
    const e = new JackpotEngine('t1');
    freezeByCB3(e);
    expect(e.isFrozen()).toBe(true);
    expect(e.history()).toHaveLength(CB3_MAX_HITS);

    // Frozen → no further payouts at all.
    e.inject(usd(500_000));
    let hits = 0;
    for (let i = 0; i < 40; i++) hits += e.onRoundSettled(ctx({ roundId: `after${i}` })).length;
    expect(hits).toBe(0);

    e.unfreeze(); // ops action after review
    expect(e.isFrozen()).toBe(false);
  });
});

describe('history', () => {
  it('records every hit and is queryable by tier and player', () => {
    const e = new JackpotEngine('t1');
    freezeByCB3(e);
    const all = e.history();
    expect(all.length).toBeGreaterThan(0);
    expect(e.history({ tier: 'MINI' }).every((h) => h.tier === 'MINI')).toBe(true);
    const who = all[0]!.playerId;
    expect(e.history({ playerId: who }).every((h) => h.playerId === who)).toBe(true);
    expect(e.history({ from: all[0]!.at, to: all[0]!.at }).length).toBeGreaterThan(0);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** Push the table over CB3 by landing three Mini jackpots inside one hour. */
function freezeByCB3(e: JackpotEngine): void {
  e.inject(usd(500_000));
  let round = 0;
  while (!e.isFrozen() && round < 300) {
    round++;
    e.onRoundSettled(ctx({ roundId: `cb3-${round}`, now: WEDNESDAY + round * 1000 }));
  }
}

/** A moment inside the Saturday window at or after this seed's Grand trigger time. */
function laterInWindow(seed: string): number {
  return grandTriggerAt(seed, SAT_IN_WINDOW) + 1000;
}

describe('timezone', () => {
  it('reads Saturday in UTC+8, not UTC', () => {
    // 2026-07-18 11:00 UTC = 19:00 UTC+8 Saturday.
    expect(zoned(SAT_IN_WINDOW).weekday).toBe(6);
    // 2026-07-17 17:00 UTC = 01:00 UTC+8 Saturday — already Saturday locally, but not in UTC.
    expect(zoned(Date.UTC(2026, 6, 17, 17, 0, 0)).weekday).toBe(6);
  });
});
