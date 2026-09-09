import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useContextStore } from '../store/context';
import { ShieldIcon } from '../icons';
import { radius, space, theme, weight } from '../theme';

/**
 * "You are inside an alliance" — shown whenever the player is in a league
 * context, and never when they are not.
 *
 * The platform and league systems are absolutely isolated (iron rule 6): a
 * league's private rooms do not appear in the public lobby, and inside a league
 * you see that league's tables and wallet instead of the platform's. That is
 * the correct behaviour and it is also indistinguishable, from the player's
 * side, from tables having gone missing and their balance having changed.
 *
 * So the switch is never silent. The banner states which alliance is active and
 * offers one tap back out — an unexplained empty lobby is the failure mode this
 * exists to prevent.
 */
export function ContextBanner() {
  const { t } = useTranslation();
  const leagueId = useContextStore((s) => s.leagueId);
  const leagueName = useContextStore((s) => s.leagueName);
  const leave = useContextStore((s) => s.leavePlatformContext);

  if (!leagueId) return null;

  return (
    <View style={styles.banner}>
      <View style={styles.iconWrap}>
        <ShieldIcon color={theme.brand} size={15} />
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {t('context.inLeague', { name: leagueName ?? leagueId })}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {t('context.isolationNote')}
        </Text>
      </View>
      <Pressable
        onPress={leave}
        style={({ pressed }) => [styles.closeButton, pressed && styles.closePressed]}
        accessibilityLabel={t('context.backToPlatform')}
      >
        <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={theme.dim} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M18 6 6 18M6 6l12 12" />
        </Svg>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.4)', // theme.brand with opacity
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.lg,
  },
  iconWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  title: {
    color: theme.brand,
    fontSize: 12,
    fontFamily: weight('800'),
  },
  subtitle: {
    color: theme.dim,
    fontSize: 10,
    fontFamily: weight('400'),
  },
  closeButton: {
    padding: space.xs,
    borderRadius: radius.card,
  },
  closePressed: {
    backgroundColor: theme.surface2,
  },
});
