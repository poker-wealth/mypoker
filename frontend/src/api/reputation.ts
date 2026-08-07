import { api } from './client';

/**
 * Player reputation. Read-only.
 *
 * Mirrors financial-core's shape exactly, including its deliberate omissions:
 * there is no permission flag here and there must never be one. Reputation
 * governs table access and chat; it has no authority over funds, and the spec
 * calls a reputation score affecting a withdrawal a critical failure.
 */

export type ReputationBand = 'VERY_POOR' | 'POOR' | 'AVERAGE' | 'GOOD' | 'EXCELLENT';

export interface Reputation {
  score: number;
  band: ReputationBand;
  roundsPlayed: number;
  /** Rounds still needed to reach 700; 0 once passed. */
  roundsToAdvance: number;
  deducted: number;
}

export const fetchReputation = (): Promise<Reputation> => api.get<Reputation>('/me/reputation');
