import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { money } from '../money';
import { radius, space, theme, weight } from '../theme';
import { Badge, Card, ListRow, Screen } from '../ui';

/**
 * VIP — tier, progress, and what each tier is worth.
 *
 * Ported from frontend/src/pages/Vip.tsx. Progress is measured between the
 * current threshold and the next, not from zero, and the headline figure is
 * EFFECTIVE volume (Texas counts in full, Baccarat at x0.3) — matching the
 * web copy so the two never disagree about what the ladder actually grades on.
 *
 * No signed-in gate here, same as WalletScreen: the shell has no reactive
 * "am I signed in" store yet, so this reads exactly like every other screen —
 * ask the server, and let a 401 speak for itself.
 */

type VipTier = 'V1' | 'V2' | 'V3' | 'V4' | 'V5';

interface GameBreakdown {
  gameId: string;
  rounds: number;
  /** micro-USD, raw stake. */
  staked: number;
  /** micro-USD, already weighted by the game's coefficient. */
  effective: number;
}

interface VipStanding {
  tier: VipTier;
  cumulativeEffective: number;
  next: { tier: VipTier; remaining: number } | null;
  progressPct: number;
  estimatedDaysToNextTier: number | null;
  breakdown: GameBreakdown[];
}

const TIER_ORDER: VipTier[] = ['V1', 'V2', 'V3', 'V4', 'V5'];

// Mirrors the web ladder's colour-per-tier, EXCEPT V3: web uses jackpot gold
// there, and this app's rule is jackpot gold is for jackpots only — so V3
// gets the plain text colour instead of borrowing that one.
const TIER_COLOR: Record<VipTier, string> = {
  V1: theme.dim,
  V2: theme.accent,
  V3: theme.text,
  V4: theme.brand,
  V5: theme.accent,
};

export function VipScreen() {
  const { t } = useTranslation();
  const vip = useQuery({
    queryKey: ['vip'],
    queryFn: () => api.get<VipStanding>('/me/vip'),
    staleTime: 60_000,
    retry: 1,
  });

  return (
    <Screen query={vip} errorLabel={{ retry: t('common.retry'), fallback: t('states.error') }}>
      {(data) => (
        <>
          <Card>
            <View style={styles.tierRow}>
              <Text style={[styles.tier, { color: TIER_COLOR[data.tier] }]}>{data.tier}</Text>
              <Text style={styles.tierTitle}>{t(`vip.title.${data.tier}`)}</Text>
            </View>

            <Text style={styles.label}>{t('vip.effectiveVolume')}</Text>
            <Text style={styles.amount}>{money(data.cumulativeEffective)}</Text>

            {data.next ? (
              <>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${data.progressPct}%` }]} />
                </View>
                <View style={styles.barRow}>
                  <Text style={styles.dimSmall}>{data.progressPct}%</Text>
                  {/* flexShrink so an unbounded money amount wraps instead of overflowing past
                      the card edge — a Text in a row needs flex/flexShrink or it will not wrap. */}
                  <Text style={[styles.dimSmall, styles.barRemaining]}>
                    {t('vip.remaining', {
                      amount: money(data.next.remaining, { symbol: false }),
                      tier: data.next.tier,
                    })}
                  </Text>
                </View>
                {data.estimatedDaysToNextTier !== null && (
                  <Text style={styles.estimate}>
                    {t('vip.estimatedUpgrade', { count: data.estimatedDaysToNextTier })}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.topTier}>{t('vip.topTier')}</Text>
            )}
          </Card>

          {data.breakdown.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('vip.byGame')}</Text>
              <Card style={styles.listCard}>
                {data.breakdown.map((g) => (
                  <ListRow
                    key={g.gameId}
                    label={t(`gameNames.${g.gameId}`, { defaultValue: g.gameId })}
                    hint={t('vip.roundsStaked', { rounds: g.rounds, staked: money(g.staked, { symbol: false }) })}
                    right={
                      <View style={styles.rightCol}>
                        <Text style={styles.rightAmount}>{money(g.effective)}</Text>
                        <Text style={styles.rightCaption}>{t('vip.counted')}</Text>
                      </View>
                    }
                  />
                ))}
              </Card>
              <Text style={styles.note}>{t('vip.coefficientNote')}</Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('vip.tiers')}</Text>
            {TIER_ORDER.map((tier) => {
              const reached = TIER_ORDER.indexOf(data.tier) >= TIER_ORDER.indexOf(tier);
              return (
                <Card key={tier} style={reached ? styles.tierCard : styles.tierCardLocked}>
                  <ListRow
                    label={t(`vip.title.${tier}`)}
                    hint={t(`vip.perks.${tier}`)}
                    right={
                      <Badge tone={reached ? 'success' : 'neutral'}>{tier}</Badge>
                    }
                  />
                </Card>
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tierRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  tier: { fontSize: 20, fontFamily: weight('900') },
  tierTitle: { color: theme.dim, fontSize: 13, fontFamily: weight('700') },
  label: { marginTop: space.sm, color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('700') },
  amount: { color: theme.text, fontSize: 24, fontFamily: weight('900') },
  barTrack: {
    marginTop: space.md,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: radius.pill, backgroundColor: theme.brand },
  barRow: { marginTop: space.xs, flexDirection: 'row', justifyContent: 'space-between' },
  dimSmall: { color: theme.dim, fontSize: 11, fontFamily: weight('400') },
  barRemaining: { flexShrink: 1, textAlign: 'right' },
  estimate: { marginTop: space.xs, color: theme.dim, fontSize: 10, fontFamily: weight('400') },
  topTier: { marginTop: space.sm, color: theme.accent, fontSize: 12, fontFamily: weight('700') },
  section: { gap: space.sm },
  sectionTitle: { paddingHorizontal: space.xs, color: theme.dim, fontSize: 11, textTransform: 'uppercase', fontFamily: weight('800') },
  listCard: { padding: 0, gap: 0 },
  rightCol: { alignItems: 'flex-end' },
  rightAmount: { color: theme.text, fontSize: 13, fontFamily: weight('700') },
  rightCaption: { color: theme.dim, fontSize: 9, fontFamily: weight('400') },
  note: { paddingHorizontal: space.xs, color: theme.dim, fontSize: 10, lineHeight: 15, fontFamily: weight('400') },
  tierCard: { padding: 0 },
  tierCardLocked: { padding: 0, opacity: 0.6 },
});
