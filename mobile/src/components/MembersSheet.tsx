import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { space, theme, weight } from '../theme';

/**
 * Who is in an alliance.
 *
 * The roster comes from `GET /leagues/:id/members`, which the GATEWAY enriches
 * with display names on the way through — financial-core owns membership but
 * not identity, so it returns ids and the gateway puts the names on. See
 * `game-server/src/gateway/league-routes.ts`.
 *
 * MEMBERS ONLY, and that is enforced on the server: a non-member gets a 404,
 * not a 403, so whether a league exists and who is in it is not a stranger's to
 * probe. Nothing here needs to re-check that — the request simply fails for
 * someone who should not see it, and the error state says so.
 *
 * WHAT IS SHOWN is what the roster actually carries: name, role, and when they
 * joined. No chip figures: what another member has won or contributed is a
 * decision about what is public inside an alliance, and not one to make in a
 * component. A member the directory could not name shows their id rather than
 * an invented placeholder.
 */

interface Member {
  playerId: string;
  role: string;
  joinedAt: string;
  /** Absent when the directory has no name for them. */
  displayName?: string;
}

export function MembersSheet({
  leagueId,
  leagueName,
  onClose,
}: {
  /** The alliance to list. Null closes the sheet. */
  leagueId: string | null;
  leagueName?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const roster = useQuery({
    queryKey: ['league', leagueId, 'members'],
    queryFn: () =>
      api.get<{ members: Member[] }>(`/leagues/${encodeURIComponent(leagueId!)}/members`),
    enabled: leagueId !== null,
    staleTime: 30_000,
  });

  return (
    <Modal visible={leagueId !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.panel, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {leagueName ?? t('alliance.title')}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {roster.isPending ? (
            <ActivityIndicator color={theme.brand} style={styles.centre} />
          ) : roster.isError ? (
            // An unreachable roster is not an empty one — saying "no members"
            // for a failed request tells the player the alliance is deserted.
            <Text style={styles.note}>{t('states.error')}</Text>
          ) : roster.data.members.length === 0 ? (
            <Text style={styles.note}>{t('alliance.noMembers')}</Text>
          ) : (
            <ScrollView bounces={false}>
              {roster.data.members.map((m) => (
                <View key={m.playerId} style={styles.row}>
                  <View style={styles.who}>
                    <Text style={styles.name} numberOfLines={1}>
                      {/* The id, when the directory has no name. Real, and
                          usable with support — better than "Unknown". */}
                      {m.displayName ?? m.playerId}
                    </Text>
                    <Text style={styles.joined}>
                      {new Date(m.joinedAt).toLocaleDateString()}
                    </Text>
                  </View>
                  {/* Owner and admin are worth marking; a plain member is the
                      default and needs no badge. */}
                  {m.role !== 'member' ? (
                    <Text style={styles.role}>{m.role.replace(/_/g, ' ')}</Text>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    maxHeight: '75%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingBottom: space.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  title: { flex: 1, color: theme.text, fontSize: 15, fontFamily: weight('700') },
  close: { color: theme.dim, fontSize: 17 },
  centre: { paddingVertical: space.xl },
  note: { color: theme.dim, fontSize: 13, textAlign: 'center', paddingVertical: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  who: { flex: 1 },
  name: { color: theme.text, fontSize: 14, fontFamily: weight('600') },
  joined: { color: theme.dim, fontSize: 11, marginTop: 2 },
  role: {
    color: theme.brand,
    fontSize: 10,
    textTransform: 'uppercase',
    fontFamily: weight('700'),
  },
});
