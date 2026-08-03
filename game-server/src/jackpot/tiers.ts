/**
 * The four per-table jackpot tiers (FairPlay v5.9 §5).
 *
 * Money is in micro-units (6dp), the platform's smallest unit: $1 = 1_000_000.
 */

export const MICROS_PER_USD = 1_000_000;
export const usd = (dollars: number): number => Math.round(dollars * MICROS_PER_USD);

export type JackpotTier = 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND';
export const TIERS: readonly JackpotTier[] = ['MINI', 'MINOR', 'MAJOR', 'GRAND'];

/** How a tier decides it is due. */
export type Cadence =
  /** Every N rounds, N drawn randomly in [min, max] — Mini and Minor. */
  | { kind: 'ROUNDS'; min: number; max: number }
  /** Once per day, at a random moment in the day — Major. */
  | { kind: 'DAILY' }
  /** At a random moment inside the Saturday 18:00–23:00 window — Grand. */
  | { kind: 'WINDOW' };

export interface TierConfig {
  tier: JackpotTier;
  /** Share of THIS table's pool paid out on a trigger. */
  payoutBps: number;
  /** The pool must reach this before the tier can pay at all. */
  minThreshold: number;
  /** Share of each 0.5% injection that lands in this tier. */
  injectionBps: number;
  cadence: Cadence;
  animationMs: number;
}

export const TIER_CONFIG: Readonly<Record<JackpotTier, TierConfig>> = {
  MINI: {
    tier: 'MINI',
    payoutBps: 500, // 5% of the Mini pool
    minThreshold: usd(10),
    injectionBps: 2000, // 20% of the injection
    cadence: { kind: 'ROUNDS', min: 25, max: 35 },
    animationMs: 3000,
  },
  MINOR: {
    tier: 'MINOR',
    payoutBps: 1500, // 15%
    minThreshold: usd(50),
    injectionBps: 3000, // 30%
    cadence: { kind: 'ROUNDS', min: 80, max: 120 },
    animationMs: 5000,
  },
  MAJOR: {
    tier: 'MAJOR',
    payoutBps: 4000, // 40%
    minThreshold: usd(200),
    injectionBps: 2500, // 25%
    cadence: { kind: 'DAILY' },
    animationMs: 8000,
  },
  GRAND: {
    tier: 'GRAND',
    payoutBps: 7000, // 70%
    minThreshold: usd(1000),
    injectionBps: 2500, // 25%
    cadence: { kind: 'WINDOW' },
    animationMs: 10_000,
  },
};

/** Injection rate: 0.5% of the WINNER'S PROFIT. Losers never pay jackpot cost. */
export const INJECTION_BPS = 50;

/** The Grand window: Saturday 18:00–23:00, in UTC+8. */
export const GRAND_WINDOW = {
  timezoneOffsetHours: 8,
  weekday: 6, // Saturday
  startHour: 18,
  endHour: 23,
} as const;

/**
 * Split an injection across the four tiers, 20/30/25/25.
 * The remainder goes to Grand so the parts sum to exactly `total` — no dust created or lost.
 */
export function splitInjection(total: number): Record<JackpotTier, number> {
  const mini = Math.floor((total * TIER_CONFIG.MINI.injectionBps) / 10000);
  const minor = Math.floor((total * TIER_CONFIG.MINOR.injectionBps) / 10000);
  const major = Math.floor((total * TIER_CONFIG.MAJOR.injectionBps) / 10000);
  return { MINI: mini, MINOR: minor, MAJOR: major, GRAND: total - mini - minor - major };
}

/** 0.5% of the winner's profit — the only money that ever enters a jackpot pool. */
export function injectionFor(winnerProfit: number): number {
  if (winnerProfit <= 0) return 0; // losers contribute nothing, ever
  return Math.floor((winnerProfit * INJECTION_BPS) / 10000);
}
