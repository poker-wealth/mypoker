import { api } from './client';

/** VIP standing. Mirrors financial-core/src/vip/volume-tracker.ts. */

export type VipTier = 'V1' | 'V2' | 'V3' | 'V4' | 'V5';

export interface GameBreakdown {
  gameId: string;
  rounds: number;
  /** micro-USD, raw stake. */
  staked: number;
  won: number;
  /** micro-USD, already weighted by the game's coefficient. */
  effective: number;
  actualRtp: string | null;
}

export interface VipStanding {
  tier: VipTier;
  title: string;
  cumulativeEffective: number;
  monthlyEffective: number;
  next: { tier: VipTier; title: string; threshold: number; remaining: number } | null;
  progressPct: number;
  breakdown: GameBreakdown[];
}

export const fetchVip = (): Promise<VipStanding> => api.get<VipStanding>('/me/vip');
