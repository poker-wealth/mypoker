import { api } from './client';

/**
 * Player statistics and game history.
 *
 * Mirrors what financial-core can honestly derive from the ledger. VPIP, PFR and
 * largest pot are absent because no data source for them exists — the ledger
 * records a round's net movement, not the actions within it. Don't add fields
 * here that the server can't actually produce.
 */

export interface PlayerStats {
  handsPlayed: number;
  handsWon: number;
  /** Percentage to one decimal, e.g. '52.3'. Null when no hands have been played. */
  winRate: string | null;
  biggestWin: string;
  /** Signed — negative when the player is down. */
  netProfit: string;
  /**
   * Raw staked volume. NOT the effective volume the VIP ladder grades on, which
   * weights per game; the ledger doesn't record which game a round was.
   * Do not derive a tier from this.
   */
  cumulativeVolumeRaw: string;
}

export interface HistoryEntry {
  roundId: string;
  /** Signed decimal string: what the player netted on this round. */
  net: string;
  won: boolean;
  at: string;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  /** Feed back as `cursor` for the next page. Null when there are no more. */
  nextCursor: string | null;
}

/** Reporting windows the Data tab offers. Must match financial-core's StatsPeriod. */
export type StatsPeriod = 'today' | '7d' | '30d' | 'all';

export function fetchStats(period?: StatsPeriod): Promise<PlayerStats> {
  const suffix = period && period !== 'all' ? `?period=${period}` : '';
  return api.get<PlayerStats>(`/me/stats${suffix}`);
}

export function fetchHistory(
  params: { limit?: number; cursor?: string; period?: StatsPeriod } = {},
): Promise<HistoryPage> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  // 'all' is the server default; sending it would only make cache keys noisier.
  if (params.period && params.period !== 'all') query.set('period', params.period);
  const suffix = query.toString();
  return api.get<HistoryPage>(`/me/history${suffix ? `?${suffix}` : ''}`);
}
