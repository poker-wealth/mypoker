import { BehaviorTracker, type DecisionSample } from '../../src/players/behavior-tracker';

const BASE = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** Record `n` decisions, one per `stepMs`, from `reaction(i)` and `bet(i)`. */
function feed(
  t: BehaviorTracker,
  n: number,
  reaction: (i: number) => number,
  bet: (i: number) => number | null = () => null,
  stepMs = 1_000,
): void {
  for (let i = 0; i < n; i++) {
    const s: DecisionSample = { reactionMs: reaction(i), betRatio: bet(i), at: BASE + i * stepMs };
    t.record(s);
  }
}

describe('BehaviorTracker', () => {
  it('is NORMAL with too few samples, whatever they look like', () => {
    const t = new BehaviorTracker();
    feed(t, 3, () => 300, () => 0.5); // botlike, but only 3 samples
    expect(t.status(BASE + HOUR)).toBe('NORMAL');
    expect(t.signals(BASE + HOUR).fixedReactionDelay).toBe(false);
  });

  it('is NORMAL for human-like play — varied timing, varied sizing, short session', () => {
    const t = new BehaviorTracker();
    const human = [820, 1600, 2400, 900, 3100, 1200, 2000, 700, 2600, 1500, 1900, 1100];
    feed(t, human.length, (i) => human[i]!, (i) => [0.27, 0.61, 0.44, 0.83, 0.39][i % 5]!);
    expect(t.signals(BASE + HOUR)).toEqual({
      fixedReactionDelay: false,
      perfectRandomTiming: false,
      alwaysExactGtoSizing: false,
      noFatigueOverLongSession: false,
    });
    expect(t.status(BASE + HOUR)).toBe('NORMAL');
  });

  it('detects a fixed reaction delay (near-zero variance)', () => {
    const t = new BehaviorTracker();
    feed(t, 12, (i) => 300 + (i % 2 === 0 ? 2 : -2)); // ~300ms, tiny jitter
    expect(t.signals(BASE + HOUR).fixedReactionDelay).toBe(true);
  });

  it('detects perfect-random timing (flat over a wide range) but not human clustering', () => {
    const flat = new BehaviorTracker();
    feed(flat, 16, (i) => 500 + Math.round((i * 4500) / 15)); // evenly 500..5000
    expect(flat.signals(BASE + HOUR).perfectRandomTiming).toBe(true);

    const clustered = new BehaviorTracker();
    // Fourteen around 2000, two outliers to give the same wide range — a human's shape.
    const c = [1950, 2050, 1900, 2100, 2000, 1980, 2020, 1930, 2070, 2010, 1990, 2040, 500, 4000];
    feed(clustered, c.length, (i) => c[i]!);
    expect(clustered.signals(BASE + HOUR).perfectRandomTiming).toBe(false);
  });

  it('detects always-exact GTO sizing but not eyeballed sizing', () => {
    const exact = new BehaviorTracker();
    feed(exact, 8, () => 1500, (i) => [0.5, 0.75, 0.6667, 0.3333, 1, 0.5, 0.75, 0.5][i]!);
    expect(exact.signals(BASE + HOUR).alwaysExactGtoSizing).toBe(true);

    const eyeballed = new BehaviorTracker();
    feed(eyeballed, 8, () => 1500, (i) => [0.52, 0.71, 0.63, 0.38, 0.9, 0.47, 0.68, 0.55][i]!);
    expect(eyeballed.signals(BASE + HOUR).alwaysExactGtoSizing).toBe(false);
  });

  it('only flags no-fatigue after a genuine 16h+ session', () => {
    const t = new BehaviorTracker();
    feed(t, 20, (i) => 300 + (i % 2 === 0 ? 2 : -2)); // flat timing across the session
    expect(t.signals(BASE + 2 * HOUR).noFatigueOverLongSession).toBe(false); // 2h — too short
    expect(t.signals(BASE + 17 * HOUR).noFatigueOverLongSession).toBe(true); // 17h, no drift
  });

  it('FLAGS a seat whose tells combine past the threshold, and never bans', () => {
    const t = new BehaviorTracker();
    // Fixed delay (30) + always-exact GTO (20) + no fatigue over 17h (20) = 70 >= 60.
    feed(t, 20, (i) => 300 + (i % 2 === 0 ? 2 : -2), () => 0.5);
    expect(t.status(BASE + 17 * HOUR)).toBe('FLAGGED');
  });

  it('a single tell stays NORMAL — no one signal reaches the flag threshold alone', () => {
    const t = new BehaviorTracker();
    feed(t, 12, (i) => 300 + (i % 2 === 0 ? 2 : -2)); // only fixed delay (30 < 60), short session
    expect(t.status(BASE + HOUR)).toBe('NORMAL');
  });

  it('ignores a nonsensical reaction sample', () => {
    const t = new BehaviorTracker();
    feed(t, 5, () => -1); // all rejected
    expect(t.size).toBe(0);
  });
});
