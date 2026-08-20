import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { radius, space, theme } from '../theme';
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

/** Money for display, from micro-USD. Mirrors frontend/src/lib/money.ts money(). */
function money(micros: number): string {
  return `₮${(micros / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The bare number, no currency mark — for interpolating into a template that
 * already carries its own ₮ (vip.remaining, vip.roundsStaked). Using money()
 * there would double the symbol.
 */
function amountOnly(micros: number): string {
  return (micros / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

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
                  <Text style={styles.dimSmall}>
                    {t('vip.remaining', {
                      amount: amountOnly(data.next.remaining),
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
                    hint={t('vip.roundsStaked', { rounds: g.rounds, staked: amountOnly(g.staked) })}
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
  tier: { fontSize: 20, fontWeight: '900' },
  tierTitle: { color: theme.dim, fontSize: 13, fontWeight: '700' },
  label: { marginTop: space.sm, color: theme.dim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  amount: { color: theme.text, fontSize: 24, fontWeight: '900' },
  barTrack: {
    marginTop: space.md,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: radius.pill, backgroundColor: theme.brand },
  barRow: { marginTop: space.xs, flexDirection: 'row', justifyContent: 'space-between' },
  dimSmall: { color: theme.dim, fontSize: 11 },
  estimate: { marginTop: space.xs, color: theme.dim, fontSize: 10 },
  topTier: { marginTop: space.sm, color: theme.accent, fontSize: 12, fontWeight: '700' },
  section: { gap: space.sm },
  sectionTitle: { paddingHorizontal: space.xs, color: theme.dim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  listCard: { padding: 0, gap: 0 },
  rightCol: { alignItems: 'flex-end' },
  rightAmount: { color: theme.text, fontSize: 13, fontWeight: '700' },
  rightCaption: { color: theme.dim, fontSize: 9 },
  note: { paddingHorizontal: space.xs, color: theme.dim, fontSize: 10, lineHeight: 15 },
  tierCard: { padding: 0 },
  tierCardLocked: { padding: 0, opacity: 0.6 },
});
