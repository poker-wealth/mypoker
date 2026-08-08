import { api } from './client';

/** Public jackpot state. Mirrors game-server/src/gateway/jackpot-routes.ts. */

export type JackpotTier = 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND';

export interface TierState {
  tier: JackpotTier;
  /** micro-USD */
  amount: number;
  /** micro-USD; below this the tier cannot pay out at all. */
  minThreshold: number;
  armed: boolean;
  payoutBps: number;
  injectionBps: number;
  cadence: 'ROUNDS' | 'DAILY' | 'WINDOW';
}

export interface JackpotState {
  tiers: TierState[];
  /** micro-USD */
  total: number;
  grand: {
    open: boolean;
    opensAt: string;
    closesAt: string;
    timezoneOffsetHours: number;
    weekday: number;
    startHour: number;
    endHour: number;
  };
}

export const fetchJackpot = (): Promise<JackpotState> => api.get<JackpotState>('/jackpot');

/** One past hit, read from the ledger — so this survives restarts and deploys. */
export interface JackpotHit {
  at: string;
  tier: string;
  tableId: string | null;
  roundId: string | null;
  /** The winning account. Never a balance, and never the rest of their ledger. */
  accountId: string;
  /** Decimal string, USD. */
  amount: string;
}

/**
 * Past hits. Defaults to the last 30 days per §5; `from`/`to` give the full
 * date-range query the spec also requires.
 */
export const fetchJackpotHistory = (range?: {
  from?: string;
  to?: string;
  tier?: string;
}): Promise<{ hits: JackpotHit[] }> => {
  const query = new URLSearchParams();
  if (range?.from) query.set('from', range.from);
  if (range?.to) query.set('to', range.to);
  if (range?.tier) query.set('tier', range.tier);
  const suffix = query.toString();
  return api.get<{ hits: JackpotHit[] }>(`/jackpot/history${suffix ? `?${suffix}` : ''}`);
};
