import { api } from './client';

/** Public payout rates (feature queue #12). Mirrors financial-core getPublicRtp. */
export interface GameRtp {
  gameId: string;
  actualRtp: string | null;
  sampleRounds: number;
  theoreticalRtp: string | null;
}

/** Payout-affecting rules for one game, as committed. */
export interface GameRules {
  gameId: string;
  rakeBps: number;
  jackpotBps: number;
  paytable: Record<string, number>;
}

/**
 * The rule-version stamp the rates were earned under.
 *
 * `chainTx` is null when the rules are published but not yet anchored on-chain.
 * The distinction is the entire point of the stamp, so the UI must render the
 * two states differently and never imply the stronger one.
 */
export interface RuleStamp {
  version: string;
  manifestRevision: number;
  games: GameRules[];
  chainTx: string | null;
  committedAt: string | null;
}

export interface RtpFeed {
  games: GameRtp[];
  /** Absent on an older server, or when the commitment could not be read. */
  rules?: RuleStamp | null;
}

export const fetchRtp = (): Promise<RtpFeed> => api.get<RtpFeed>('/fairness/rtp');
