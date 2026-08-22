import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { moneyFromDecimal } from '../money';
import { radius, space, theme } from '../theme';
import { Button, Card, EmptyState, ErrorState, ListRow, Screen, Segmented, Skeleton } from '../ui';
import { TrendChart } from '../TrendChart';

/**
 * Data — play statistics and history. Ported from frontend/src/pages/Data.tsx.
 *
 * VPIP, PFR and biggest-pot are absent for the same reason they are absent on
 * the web: the ledger records a round's net movement, not the actions inside
 * it, so those figures cannot be honestly derived.
 *
 * The web's trend chart is chart.js-on-canvas, which has no native
 * equivalent; it is replaced by `TrendChart` (SVG, already built) rather than
 * reimplemented here. The web's play-distribution donut is left out entirely
 * rather than given a second bespoke chart, and because its colour set
 * (six fixed hex hues) does not reduce to this app's design tokens without
 * inventing a palette.
 *
 * No sign-in gate, same as VipScreen/AllianceScreen/ProfileScreen: there is
 * no reactive session/player store here, only a token (see session.ts). This
 * just asks the server and lets a 401 speak for itself through Screen's
 * ErrorState.
 *
 * `history` (the round list) is the primary query, wrapped in `Screen`. The
 * period Segmented sits above it, outside Screen, so it stays visible and
 * usable while a period switch is refetching. `stats` is a second query with
 * its own spinner/error, same shape as `discover` in AllianceScreen — its
 * failure or slow load must not blank the round list underneath it.
 */

type StatsPeriod = 'today' | '7d' | '30d' | 'all';

interface PlayerStats {
  handsPlayed: number;
  handsWon: number;
  /** Percentage to one decimal, e.g. '52.3'. Null when no hands have been played. */
  winRate: string | null;
  biggestWin: string;
  /** Signed decimal string — negative when the player is down. */
  netProfit: string;
}

interface HistoryEntry {
  roundId: string;
  /** Signed decimal string: what the player netted on this round. */
  net: string;
  won: boolean;
  at: string;
}

interface HistoryPage {
  entries: HistoryEntry[];
  /** Feed back as `cursor` for the next page. Null when there are no more. */
  nextCursor: string | null;
}

const PERIODS: { value: StatsPeriod; key: string }[] = [
  { value: 'today', key: 'data.periodToday' },
  { value: '7d', key: 'data.period7d' },
  { value: '30d', key: 'data.period30d' },
  { value: 'all', key: 'data.periodAll' },
];

function fetchHistory(params: { limit?: number; cursor?: string; period?: StatsPeriod }): Promise<HistoryPage> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  // 'all' is the server default; sending it would only make cache keys noisier.
  if (params.period && params.period !== 'all') query.set('period', params.period);
  const suffix = query.toString();
  return api.get<HistoryPage>(`/me/history${suffix ? `?${suffix}` : ''}`);
}

export function DataScreen() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<StatsPeriod>('today');

  const stats = useQuery({
    queryKey: ['stats', period],
    queryFn: () => api.get<PlayerStats>(`/me/stats${period !== 'all' ? `?period=${period}` : ''}`),
    // Stats move only when a hand settles, so a short window avoids refetching
    // on every visit without ever showing badly stale numbers.
    staleTime: 30_000,
    retry: 1,
  });

  const history = useInfiniteQuery<HistoryPage>({
    // period is part of the key: switching window starts a fresh pagination
    // rather than appending a different window's rounds onto the current list.
    queryKey: ['history', period],
    queryFn: ({ pageParam }) =>
      fetchHistory({ limit: 20, period, ...(pageParam ? { cursor: String(pageParam) } : {}) }),
    initialPageParam: undefined as string | undefined,
    // The server returns null once it has run out, which ends the pagination.
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: 1,
  });

  return (
    <View style={styles.container}>
      <View style={styles.periodBar}>
        <Segmented
          options={PERIODS.map((p) => ({ value: p.value, label: t(p.key) }))}
          value={period}
          onChange={setPeriod}
        />
      </View>

      <Screen query={history} errorLabel={{ retry: t('common.retry'), fallback: t('states.error') }}>
        {(data) => {
          // History arrives newest-first across pages, same order TrendChart expects.
          const rounds = data.pages.flatMap((p) => p.entries);

          return (
            <>
              <Overview stats={stats} />

              {rounds.length > 1 && (
                <Card>
                  <Text style={styles.cardTitle}>{t('data.profitTrend')}</Text>
                  <TrendChart points={rounds.map((r) => ({ net: Number(r.net) || 0, at: r.at }))} />
                </Card>
              )}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('data.recentRounds')}</Text>

                {rounds.length === 0 ? (
                  <Card>
                    <EmptyState title={t('data.noRounds')} body={t('data.noRoundsBlurb')} />
                  </Card>
                ) : (
                  <Card style={styles.listCard}>
                    {rounds.map((r) => (
                      <RoundRow key={r.roundId} round={r} />
                    ))}
                  </Card>
                )}

                {history.hasNextPage && (
                  <Button
                    variant="ghost"
                    disabled={history.isFetchingNextPage}
                    onPress={() => void history.fetchNextPage()}
                  >
                    {history.isFetchingNextPage ? t('common.loading') : t('data.loadMore')}
                  </Button>
                )}
              </View>
            </>
          );
        }}
      </Screen>
    </View>
  );
}

/**
 * The stat tile grid — hands, win rate, net profit, biggest win. A second,
 * independent query: a failure or slow load here must not blank the round
 * list Screen is wrapping, same reasoning as `discover` inside AllianceScreen.
 */
function Overview({
  stats,
}: {
  stats: {
    data?: PlayerStats;
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
    error: unknown;
    refetch: () => void;
  };
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('data.overview')}</Text>

      {stats.isPending && (
        <View style={styles.tileGrid}>
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} style={styles.tile}>
              <Skeleton width={48} />
              <Skeleton width={36} />
            </Card>
          ))}
        </View>
      )}

      {stats.isError && (
        <Card>
          <ErrorState
            message={stats.error instanceof Error ? stats.error.message : t('states.error')}
            onRetry={() => stats.refetch()}
            retryLabel={t('common.retry')}
          />
        </Card>
      )}

      {stats.isSuccess && stats.data && (
        <View style={styles.tileGrid}>
          <Tile label={t('data.hands')} value={String(stats.data.handsPlayed)} />
          <Tile
            label={t('data.winRate')}
            value={stats.data.winRate === null ? '—' : `${stats.data.winRate}%`}
          />
          <Tile
            label={t('data.netProfit')}
            value={moneyFromDecimal(stats.data.netProfit, { sign: true })}
            tone={Number(stats.data.netProfit) >= 0 ? 'success' : 'danger'}
          />
          <Tile label={t('account.statBiggestWin')} value={moneyFromDecimal(stats.data.biggestWin)} tone="accent" />
        </View>
      )}
    </View>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' | 'accent' }) {
  const color =
    tone === 'success' ? theme.success : tone === 'danger' ? theme.danger : tone === 'accent' ? theme.accent : theme.text;
  return (
    <Card style={styles.tile}>
      <Text style={[styles.tileValue, { color }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </Card>
  );
}

function RoundRow({ round }: { round: HistoryEntry }) {
  const net = Number(round.net) || 0;
  const up = net >= 0;
  // Round ids are long; the tail is the part that differs between them.
  const label = `…${round.roundId.slice(-10)}`;
  const date = new Date(round.at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <ListRow
      label={label}
      hint={date}
      right={
        <Text style={[styles.roundNet, { color: up ? theme.success : theme.danger }]}>
          {moneyFromDecimal(round.net, { sign: true })}
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  periodBar: { paddingHorizontal: space.lg, paddingTop: space.lg },
  section: { gap: space.sm },
  sectionTitle: { paddingHorizontal: space.xs, color: theme.dim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  cardTitle: { color: theme.dim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: '31%', gap: 2 },
  tileValue: { fontSize: 16, fontWeight: '900' },
  tileLabel: { color: theme.dim, fontSize: 10 },
  listCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  roundNet: { fontSize: 13, fontWeight: '700' },
});
