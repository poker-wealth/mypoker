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

/**
 * `day` (YYYY-MM-DD, UTC) reports on one calendar day and OVERRIDES `period`
 * server-side, so only one of the two is ever sent — sending both would leave
 * the URL claiming a window the answer does not describe.
 */
export function fetchStats(
  period?: StatsPeriod,
  day?: string,
  range?: { from: string; to: string },
): Promise<PlayerStats> {
  const query = new URLSearchParams();
  // Narrowest wins, matching the server's own precedence — sending two would
  // leave the URL claiming a window the answer does not describe.
  if (range) {
    query.set('from', range.from);
    query.set('to', range.to);
  } else if (day) query.set('day', day);
  else if (period && period !== 'all') query.set('period', period);
  const suffix = query.toString();
  return api.get<PlayerStats>(`/me/stats${suffix ? `?${suffix}` : ''}`);
}

/**
 * The window immediately before the one a period describes, as `[from, to)`
 * whole UTC days — what a "+12.3% vs last week" figure is measured against.
 *
 * Null for 'all', which has no "before": all time is already everything, and a
 * comparison against nothing is not a comparison.
 *
 * UTC throughout, matching the server's day boundaries — computing these in
 * local time would slide the window by hours and quietly change the answer.
 */
export function previousWindow(period: StatsPeriod, now: Date = new Date()): { from: string; to: string } | null {
  const DAYS: Partial<Record<StatsPeriod, number>> = { today: 1, '7d': 7, '30d': 30 };
  const span = DAYS[period];
  if (span === undefined) return null;

  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const DAY_MS = 86_400_000;
  // Start of today, UTC — the exclusive end of the window just gone.
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(todayStart.getTime() - (period === 'today' ? 0 : (span - 1) * DAY_MS));
  const from = new Date(to.getTime() - span * DAY_MS);
  return { from: iso(from), to: iso(to) };
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
