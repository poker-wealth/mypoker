import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { DataIcon, GiftIcon, SystemIcon, WalletIcon } from '../icons';
import type { IconProps } from '../icons';
import { moneyFromDecimal } from '../money';
import { radius, space, theme, weight } from '../theme';
import { Button, Card, Screen } from '../ui';

/**
 * Messages — in-app notifications, laid out after the reference's 消息 screen:
 * a strip of category tabs over a list.
 *
 * ── The tabs are server-filtered, and they had to be ───────────────────────
 *
 * The list pages with a cursor. A tab that filtered client-side over whatever
 * pages happened to be fetched would look empty purely because the reader had
 * not scrolled far enough, and its badge would count the wrong thing — a
 * screen that lies quietly. So `kinds` is a real query parameter, added to
 * financial-core's listNotifications for this, and each tab is its own
 * infinite query with its own cursor.
 *
 * ── Which kinds sit in which tab ───────────────────────────────────────────
 *
 * Four tabs, like the reference, but over our own six kinds rather than its
 * categories: it offers Tournament and Interactions, and we have neither
 * tournaments nor a social graph to put in them.
 *
 * Money covers BOTH directions. Withdrawals were raised as SYSTEM until
 * recently, which filed them next to "your address was changed" rather than
 * with the player's money — they now have their own kind, still
 * non-suppressible, so the alarm survives the re-filing.
 *
 * JACKPOT sits under Results because the SERVER already decided that —
 * financial-core's GOVERNED_BY groups it with `notifyResults`, on the grounds
 * that "a jackpot win is a result the player would be furious to miss". The
 * mapping lives in frontend/src/api/notifications.ts so both platforms read
 * one table; a second one here would eventually disagree with it.
 *
 * Rows render from a translation KEY the server stored, never text it sent,
 * with `defaultValue` set to the key so an unrecognised kind from a newer
 * server shows something rather than throwing.
 */

type NotificationKind =
  | 'RESULT'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'PROMO'
  | 'JACKPOT'
  | 'SYSTEM';

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  titleKey: string;
  params?: Record<string, string | number>;
  read: boolean;
  createdAt: string;
}

interface NotificationPage {
  notifications: NotificationRow[];
  unread: number;
  nextCursor: string | null;
  unreadByKind: Record<NotificationKind, number>;
}

/**
 * Kept in step with MESSAGE_TABS in frontend/src/api/notifications.ts by hand,
 * the same way mobile/src/theme.ts mirrors the web's tokens — mobile cannot
 * import from frontend/src, and check:parity does not read this. Change one,
 * change the other.
 */
const TABS: { id: string; kinds: NotificationKind[]; Icon: (p: IconProps) => React.JSX.Element }[] =
  [
    { id: 'system', kinds: ['SYSTEM'], Icon: SystemIcon },
    { id: 'results', kinds: ['RESULT', 'JACKPOT'], Icon: DataIcon },
    { id: 'money', kinds: ['DEPOSIT', 'WITHDRAWAL'], Icon: WalletIcon },
    { id: 'promos', kinds: ['PROMO'], Icon: GiftIcon },
  ];

// The web's per-kind icon becomes a tinted dot — ui.tsx is icon-free by
// design. JACKPOT is the one legitimate use of jackpot cyan here: the
// notification IS about money.
const KIND_COLOR: Record<NotificationKind, string> = {
  RESULT: theme.brand,
  DEPOSIT: theme.success,
  // Money leaving, so not the same green as money arriving.
  WITHDRAWAL: theme.accent,
  PROMO: theme.accent,
  JACKPOT: theme.jackpot,
  SYSTEM: theme.dim,
};

function fetchNotifications(
  params: { limit?: number; cursor?: string; kinds?: NotificationKind[] } = {},
): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  // Comma-separated, not repeated: the gateway forwards only string query
  // values, so `?kinds=a&kinds=b` would arrive as an array and be dropped.
  if (params.kinds !== undefined) query.set('kinds', params.kinds.join(','));
  const suffix = query.toString();
  return api.get<NotificationPage>(`/me/notifications${suffix ? `?${suffix}` : ''}`);
}

function displayParams(
  params: Record<string, string | number> | undefined,
): Record<string, string | number> {
  if (!params) return {};
  const out: Record<string, string | number> = { ...params };
  if (typeof out.amount === 'string') out.amount = moneyFromDecimal(out.amount, { symbol: false });
  return out;
}

export function NotificationsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [tabId, setTabId] = useState(TABS[0]!.id);
  const tab = TABS.find((x) => x.id === tabId) ?? TABS[0]!;

  const list = useInfiniteQuery<NotificationPage>({
    // The tab is part of the key: each one keeps its own pages and its own
    // cursor, so switching back does not re-fetch from the top.
    queryKey: ['notifications', tabId],
    queryFn: ({ pageParam }) =>
      fetchNotifications({
        limit: 20,
        kinds: tab.kinds,
        ...(pageParam ? { cursor: String(pageParam) } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
    retry: 1,
  });

  /**
   * Mark read by id, not the whole account.
   *
   * This screen used to `POST /read` with no body, which marks EVERYTHING.
   * With tabs that is wrong twice over: it clears badges for tabs the reader
   * never opened, and the badges are the only reason the tab strip is worth
   * having. Only the rows actually on screen in the open tab are cleared.
   */
  const markRead = useMutation({
    mutationFn: (ids: string[]) => api.post<{ marked: number }>('/me/notifications/read', { ids }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const loaded = list.data?.pages.flatMap((p) => p.notifications) ?? [];
  const unreadHere = loaded.filter((n) => !n.read).map((n) => n.id);
  const unreadByKind = list.data?.pages[0]?.unreadByKind;

  // Keyed on the ids themselves: a new page arriving with unread rows should
  // clear those too, and re-running on every render would write per refetch.
  const unreadKey = unreadHere.join(',');
  useEffect(() => {
    if (unreadKey.length > 0 && !markRead.isPending) markRead.mutate(unreadKey.split(','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadKey]);

  const tabStrip = (
    <Card style={styles.tabsCard}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map(({ id, kinds, Icon }) => {
          const active = id === tabId;
          const count = unreadByKind
            ? kinds.reduce((sum, k) => sum + (unreadByKind[k] ?? 0), 0)
            : 0;
          const label = t(`notifications.tab.${id}`);
          return (
            <Pressable
              key={id}
              style={styles.tab}
              onPress={() => setTabId(id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={count > 0 ? `${label}, ${count}` : label}
            >
              <View style={[styles.tabIcon, active && styles.tabIconOn]}>
                <Icon color={active ? theme.brand : theme.dim} size={22} />
                {count > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, active && styles.tabLabelOn]} numberOfLines={2}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );

  return (
    <Screen
      query={list}
      header={tabStrip}
      empty={{
        when: (data) => data.pages.flatMap((p) => p.notifications).length === 0,
        title: t('notifications.empty'),
        body: t('notifications.emptyBlurb'),
      }}
      errorLabel={{ retry: t('common.retry'), fallback: t('states.error') }}
    >
      {(data) => {
        const rows = data.pages.flatMap((p) => p.notifications);
        return (
          <>
            <Card style={styles.listCard}>
              {rows.map((n) => (
                <View key={n.id} style={styles.row}>
                  <View style={[styles.dot, { backgroundColor: KIND_COLOR[n.kind] ?? theme.dim }]} />
                  <View style={styles.rowMain}>
                    <Text style={[styles.rowTitle, n.read && styles.rowTitleRead]}>
                      {t(n.titleKey, { ...displayParams(n.params), defaultValue: n.titleKey })}
                    </Text>
                    <Text style={styles.rowDate}>
                      {new Date(n.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  {!n.read && <View style={styles.unreadDot} />}
                </View>
              ))}
            </Card>

            {list.hasNextPage && (
              <Button
                variant="ghost"
                disabled={list.isFetchingNextPage}
                onPress={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? t('common.loading') : t('data.loadMore')}
              </Button>
            )}
          </>
        );
      }}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabsCard: { padding: 0, paddingVertical: space.md, gap: 0 },
  tabs: { flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', gap: space.xs, paddingHorizontal: 2 },
  tabIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconOn: { borderColor: theme.brand },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 17,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: theme.danger,
    alignItems: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontFamily: weight('800') },
  tabLabel: { color: theme.dim, fontSize: 11, textAlign: 'center', fontFamily: weight('600') },
  tabLabelOn: { color: theme.brand, fontFamily: weight('800') },

  listCard: { padding: 0, gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  dot: { marginTop: 5, width: 8, height: 8, borderRadius: radius.pill },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { color: theme.text, fontSize: 13, fontFamily: weight('700') },
  rowTitleRead: { color: theme.dim, fontFamily: weight('400') },
  rowDate: { color: theme.dim, fontSize: 10, fontFamily: weight('400') },
  unreadDot: {
    marginTop: 6,
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: theme.brand,
  },
});
