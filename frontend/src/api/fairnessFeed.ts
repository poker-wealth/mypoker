import { api } from './client';

/** Public payout rates (feature queue #12). Mirrors financial-core getPublicRtp. */
export interface GameRtp {
  gameId: string;
  actualRtp: string | null;
  sampleRounds: number;
  theoreticalRtp: string | null;
}

export const fetchRtp = (): Promise<{ games: GameRtp[] }> =>
  api.get<{ games: GameRtp[] }>('/fairness/rtp');
