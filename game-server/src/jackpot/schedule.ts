import { uint32Stream, uniformBelow } from '../fairness/rng';
import { GRAND_WINDOW, TIER_CONFIG, type JackpotTier } from './tiers';

/**
 * When a jackpot is due — and why it cannot be rigged.
 *
 * "Every Jackpot trigger is provably fair" (v5.9 §Trust Model). So no trigger moment is ever drawn
 * from `Math.random()`, which we could silently re-roll until a favoured player was sitting. Every
 * interval and every trigger moment is derived deterministically from a COMMITTED seed:
 *
 *   • it is unpredictable in advance (the seed carries a future block hash), and
 *   • it is verifiable afterwards (reveal the seed → anyone recomputes the exact moment and checks
 *     we did not fire early, late, or conveniently).
 *
 * Times are evaluated in UTC+8, the timezone the spec's Grand window is written in.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

interface Zoned {
  /** 0 = Sunday … 6 = Saturday, in UTC+8. */
  weekday: number;
  /** Epoch ms of local midnight that day. */
  dayStart: number;
  /** Stable key for the local day, e.g. "2026-07-13". */
  dayKey: string;
}

/** Read a timestamp in the jackpot timezone (UTC+8). */
export function zoned(ts: number, offsetHours: number = GRAND_WINDOW.timezoneOffsetHours): Zoned {
  const shifted = ts + offsetHours * HOUR_MS;
  const d = new Date(shifted);
  const midnightShifted = Math.floor(shifted / DAY_MS) * DAY_MS;
  return {
    weekday: d.getUTCDay(),
    dayStart: midnightShifted - offsetHours * HOUR_MS,
    dayKey: d.toISOString().slice(0, 10),
  };
}

/** The Saturday 18:00–23:00 window for the week containing `ts`. */
export function grandWindow(ts: number): { start: number; end: number; weekKey: string } {
  const z = zoned(ts);
  const daysToSaturday = GRAND_WINDOW.weekday - z.weekday;
  const saturdayMidnight = z.dayStart + daysToSaturday * DAY_MS;
  return {
    start: saturdayMidnight + GRAND_WINDOW.startHour * HOUR_MS,
    end: saturdayMidnight + GRAND_WINDOW.endHour * HOUR_MS,
    weekKey: zoned(saturdayMidnight + 12 * HOUR_MS).dayKey, // the Saturday's date
  };
}

export function isInGrandWindow(ts: number): boolean {
  const w = grandWindow(ts);
  return ts >= w.start && ts < w.end;
}

/** How many rounds until this tier is next due — drawn from the seed, so it can't be steered. */
export function nextRoundInterval(seed: string, tier: JackpotTier, epoch: number): number {
  const cadence = TIER_CONFIG[tier].cadence;
  if (cadence.kind !== 'ROUNDS') throw new Error(`${tier} is not a round-based tier`);
  const span = cadence.max - cadence.min + 1;
  const rng = uint32Stream(`${seed}:${tier}:${epoch}`);
  return cadence.min + uniformBelow(rng, span);
}

/**
 * The exact moment Major fires today — a random second inside the local day, fixed by the seed at
 * the start of the day so it cannot be moved once the day is underway.
 */
export function dailyTriggerAt(seed: string, ts: number): number {
  const z = zoned(ts);
  const rng = uint32Stream(`${seed}:MAJOR:${z.dayKey}`);
  return z.dayStart + uniformBelow(rng, 86_400) * 1000;
}

/**
 * The exact moment Grand fires this Saturday — a random second inside the 18:00–23:00 window,
 * fixed by the seed for the week. Not a fixed time, and not one we can nudge.
 */
export function grandTriggerAt(seed: string, ts: number): number {
  const w = grandWindow(ts);
  const windowSeconds = (w.end - w.start) / 1000;
  const rng = uint32Stream(`${seed}:GRAND:${w.weekKey}`);
  return w.start + uniformBelow(rng, windowSeconds) * 1000;
}
