import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { money, moneyFromDecimal } from '../money';
import { radius, space, theme, weight } from '../theme';
import { Card, ErrorState, Segmented, Skeleton } from '../ui';

/**
 * Jackpot — four tiers, their pools, and the Grand window. Ported from
 * `frontend/src/pages/Jackpot.tsx`.
 *
 * The design question carried over from the web page: what should a locked
 * tier look like? A pool below its threshold cannot pay out at all, and
 * showing it identically to an armed one would imply a prize that is not
 * actually available. So a locked tier is dimmed and states what it still
 * needs, and the Grand tier — which can only drop inside a five-hour
 * Saturday window — carries a countdown rather than a number that looks
 * claimable at any moment.
 *
 * Two things the web page has that this one deliberately does not:
 *
 *   The trophy's pulse (`motion/react`, `animate={{ scale: [1, 1.12, 1] }}`)
 *   has no React Native equivalent without pulling in an animation library,
 *   which is out of scope here — the same call TrendChart.tsx makes about
 *   Chart.js's canvas. The Grand window renders in its final state instead,
 *   still distinguished by colour (success when open, dim when not).
 *
 *   The trophy artwork (`/brand/unnamed.png`) is not bundled into the mobile
 *   app — `mobile/assets/brand` has no such file — so gold colour and text
 *   carry the emphasis alone, without the image.
 *
 * Jackpot gold (`theme.jackpot`) is used only where a pool is: the total
 * banner, the Grand tier, and Grand-tier history rows. Nowhere else.
 */

type JackpotTier = 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND';

interface TierState {
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

interface JackpotState {
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

/** One past hit, read from the ledger — so a trigger the ledger refused never appears here. */
interface JackpotHit {
  at: string;
  tier: string;
  tableId: string | null;
  roundId: string | null;
  /** The winning account. Never a balance, never the rest of their ledger. */
  accountId: string;
  /** Decimal string, USD. */
  amount: string;
}

function fetchJackpotHistory(range?: { from?: string }): Promise<{ hits: JackpotHit[] }> {
  const query = new URLSearchParams();
  if (range?.from) query.set('from', range.from);
  const suffix = query.toString();
  return api.get<{ hits: JackpotHit[] }>(`/jackpot/history${suffix ? `?${suffix}` : ''}`);
}

/** hex -> rgba at an alpha. Only ever fed a `theme.*` token, never a new hex. */
function alpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Tier -> colour. The web has a fifth token, `info` (blue), for MINI; this
 * theme carries only brand/accent/success/danger/jackpot/dim (see
 * `mobile/src/theme.ts`), so MINI falls back to accent alongside MINOR
 * rather than inventing a new hex or borrowing success/danger's win/loss
 * meaning for a tier that is neither.
 */
const TIER_COLOR: Record<JackpotTier, string> = {
  MINI: theme.accent,
  MINOR: theme.accent,
  MAJOR: theme.brand,
  GRAND: theme.jackpot,
};

export function JackpotScreen() {
  const { t } = useTranslation();

  const jackpot = useQuery({
    queryKey: ['jackpot'],
    queryFn: () => api.get<JackpotState>('/jackpot'),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {jackpot.isPending &&
        [0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <Skeleton width={64} />
            <Skeleton width={140} />
          </Card>
        ))}

      {jackpot.isError && (
        <Card>
          <ErrorState
            message={jackpot.error instanceof Error ? jackpot.error.message : t('states.error')}
            onRetry={() => jackpot.refetch()}
            retryLabel={t('common.retry')}
          />
        </Card>
      )}

      {jackpot.isSuccess && (
        <>
          <View style={styles.totalBanner}>
            <Text style={styles.totalLabel}>{t('jackpot.totalPools')}</Text>
            <Text style={styles.totalValue}>{money(jackpot.data.total)}</Text>
          </View>

          <GrandWindow grand={jackpot.data.grand} />

          <View style={styles.tierList}>
            {jackpot.data.tiers.map((tier) => (
              <TierCard key={tier.tier} tier={tier} />
            ))}
          </View>

          <History />

          <Text style={styles.howItWorks}>{t('jackpot.howItWorks')}</Text>
        </>
      )}
    </ScrollView>
  );
}

function TierCard({ tier }: { tier: TierState }) {
  const { t } = useTranslation();
  const color = TIER_COLOR[tier.tier] ?? theme.brand;
  const progress = Math.min(100, (tier.amount / tier.minThreshold) * 100);

  return (
    <Card style={tier.armed ? { borderColor: alpha(color, 0.5) } : undefined}>
      <View style={styles.tierHeader}>
        <Text style={[styles.tierName, { color: tier.armed ? color : theme.dim }]}>
          {t(`jackpot.tier.${tier.tier}`)}
        </Text>
        <Text style={styles.tierMeta}>
          {t(`jackpot.cadence.${tier.cadence}`)} · {t('jackpot.paysOut', { pct: tier.payoutBps / 100 })}
        </Text>
      </View>

      <Text style={[styles.tierAmount, { color: tier.armed ? color : theme.dim }]}>{money(tier.amount)}</Text>

      {/* A tier below its threshold cannot pay at all. Saying so is the whole
          point of the row — otherwise it reads as a prize that is available. */}
      {!tier.armed && (
        <>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.needsMore}>
            {t('jackpot.needsMore', { amount: money(tier.minThreshold - tier.amount, { symbol: false }) })}
          </Text>
        </>
      )}
    </Card>
  );
}

/**
 * The Grand window, as a countdown.
 *
 * Grand can only drop inside Saturday 18:00–23:00 (UTC+8), and all three of
 * pool >= threshold, players seated, and inside the window must hold at
 * once. A bare number would imply it could land any time.
 */
function GrandWindow({ grand }: { grand: JackpotState['grand'] }) {
  const { t } = useTranslation();
  const target = useMemo(
    () => new Date(grand.open ? grand.closesAt : grand.opensAt).getTime(),
    [grand.open, grand.closesAt, grand.opensAt],
  );
  const [remaining, setRemaining] = useState(() => target - Date.now());

  useEffect(() => {
    setRemaining(target - Date.now());
    const id = setInterval(() => setRemaining(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const total = Math.max(0, remaining);
  const days = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const mins = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);

  return (
    <View style={[styles.grandCard, grand.open ? styles.grandOpen : styles.grandClosed]}>
      <View style={[styles.grandDot, { backgroundColor: grand.open ? theme.success : theme.dim }]} />
      <View style={styles.grandBody}>
        <Text style={[styles.grandTitle, { color: grand.open ? theme.success : theme.text }]}>
          {grand.open ? t('jackpot.windowOpen') : t('jackpot.windowClosed')}
        </Text>
        <Text style={styles.grandTime}>
          {grand.open
            ? t('jackpot.closesIn', { time: `${hours}h ${mins}m ${secs}s` })
            : t('jackpot.opensIn', { time: `${days}d ${hours}h ${mins}m` })}
        </Text>
      </View>
    </View>
  );
}

type HistoryRange = '30' | '90' | 'all';

/**
 * Past hits (§5: "No time limit. Player UI default: last 30 days + full
 * date-range query.").
 *
 * Thirty days by default with an explicit control to widen it, rather than
 * an infinite scroll: the default answers "is this thing actually paying
 * out?", which is the question a player looking at a locked tier is really
 * asking. Read from the ledger, so it is the record of hits that were PAID.
 *
 * Mounted only once the main jackpot query succeeds, same as the web page —
 * a history query started against tiers that failed to load has nothing
 * useful to show yet.
 */
function History() {
  const { t } = useTranslation();
  const [range, setRange] = useState<HistoryRange>('30');

  const params = useMemo(() => {
    if (range === 'all') return undefined;
    const from = new Date(Date.now() - Number(range) * 86_400_000).toISOString();
    return { from };
  }, [range]);

  const history = useQuery({
    queryKey: ['jackpot', 'history', params ?? null],
    queryFn: () => fetchJackpotHistory(params),
    staleTime: 60_000,
    retry: 1,
  });

  return (
    <View style={styles.historySection}>
      <Text style={styles.sectionTitle}>{t('jackpot.history')}</Text>

      <Segmented
        options={[
          { value: '30', label: t('jackpot.lastDays', { count: 30 }) },
          { value: '90', label: t('jackpot.lastDays', { count: 90 }) },
          { value: 'all', label: t('jackpot.allTime') },
        ]}
        value={range}
        onChange={setRange}
      />

      {history.isPending && (
        <Card>
          <Skeleton width={220} />
        </Card>
      )}

      {history.isError && (
        <Card>
          <ErrorState
            message={history.error instanceof Error ? history.error.message : t('states.error')}
            onRetry={() => history.refetch()}
            retryLabel={t('common.retry')}
          />
        </Card>
      )}

      {history.isSuccess && history.data.hits.length === 0 && (
        <Card>
          <Text style={styles.noHits}>{t('jackpot.noHits')}</Text>
        </Card>
      )}

      {history.isSuccess && history.data.hits.length > 0 && (
        <Card style={styles.historyCard}>
          {history.data.hits.map((h) => (
            <HistoryRow key={`${h.roundId ?? 'r'}-${h.tier}-${h.at}`} hit={h} />
          ))}
        </Card>
      )}
    </View>
  );
}

function HistoryRow({ hit }: { hit: JackpotHit }) {
  const { t } = useTranslation();
  const tier = hit.tier.toUpperCase() as JackpotTier;
  const color = TIER_COLOR[tier] ?? theme.dim;
  // An account id, not a nickname: the ledger knows accounts, and inventing a
  // display name here would mean guessing.
  const account = hit.accountId.length > 14 ? `${hit.accountId.slice(0, 6)}…${hit.accountId.slice(-4)}` : hit.accountId;

  return (
    <View style={styles.historyRow}>
      <Text style={[styles.historyTier, { color }]}>{t(`jackpot.tier.${tier}`, { defaultValue: hit.tier })}</Text>
      <View style={styles.historyMain}>
        <Text style={styles.historyAccount} numberOfLines={1}>
          {account}
        </Text>
        <Text style={styles.historyDate}>{new Date(hit.at).toLocaleDateString()}</Text>
      </View>
      <Text style={styles.historyAmount}>{moneyFromDecimal(hit.amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.lg, gap: space.md },
  totalBanner: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: alpha(theme.jackpot, 0.3),
    backgroundColor: alpha(theme.jackpot, 0.1),
    padding: space.md,
    alignItems: 'center',
    gap: 4,
  },
  totalLabel: {
    color: alpha(theme.jackpot, 0.8),
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6, fontFamily: weight('800') },
  totalValue: { color: theme.jackpot, fontSize: 28, fontFamily: weight('900') },
  tierList: { gap: space.sm },
  tierHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  tierName: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: weight('800') },
  tierMeta: { color: theme.dim, fontSize: 10, fontFamily: weight('400') },
  tierAmount: { fontSize: 22, fontFamily: weight('900') },
  progressTrack: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: alpha(theme.dim, 0.4) },
  needsMore: { color: theme.dim, fontSize: 10, fontFamily: weight('400') },
  grandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.md,
  },
  grandOpen: { borderColor: alpha(theme.success, 0.4), backgroundColor: alpha(theme.success, 0.1) },
  grandClosed: { borderColor: theme.border, backgroundColor: theme.surface },
  grandDot: { width: 10, height: 10, borderRadius: 5 },
  grandBody: { flex: 1, gap: 2 },
  grandTitle: { fontSize: 14, fontFamily: weight('700') },
  grandTime: { color: theme.dim, fontSize: 11, fontFamily: weight('400') },
  historySection: { gap: space.sm },
  sectionTitle: {
    color: theme.dim,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4, fontFamily: weight('800') },
  noHits: { color: theme.dim, fontSize: 12, textAlign: 'center', paddingVertical: space.sm, fontFamily: weight('400') },
  historyCard: { padding: 0, paddingHorizontal: space.md, gap: 0 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  historyTier: { fontSize: 9, textTransform: 'uppercase', fontFamily: weight('900') },
  historyMain: { flex: 1, gap: 1 },
  historyAccount: { color: theme.dim, fontSize: 11, fontFamily: weight('400') },
  historyDate: { color: theme.dim, fontSize: 10, fontFamily: weight('400') },
  historyAmount: { color: theme.success, fontSize: 13, fontFamily: weight('700') },
  howItWorks: { color: theme.dim, fontSize: 10, lineHeight: 15, paddingHorizontal: 2, fontFamily: weight('400') },
});
