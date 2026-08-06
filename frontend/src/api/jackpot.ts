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
