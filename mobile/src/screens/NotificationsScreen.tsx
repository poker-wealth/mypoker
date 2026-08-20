import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { radius, space, theme } from '../theme';
import { Button, Card, Screen } from '../ui';

/**
 * In-app notifications. Ported from frontend/src/pages/Notifications.tsx.
 *
 * Marked read on open rather than per item — matching the web original's
 * reasoning: a badge left up after the list has been looked at means nothing.
 *
 * Each row renders from a translation KEY the server stored, not text it
 * sent, with `defaultValue` set to that same key so an unrecognised kind from
 * a newer server still shows something instead of throwing.
 */

type NotificationKind = 'RESULT' | 'DEPOSIT' | 'PROMO' | 'JACKPOT' | 'SYSTEM';

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
}

// No icon set is bundled for the native app (ui.tsx is icon-free by design),
// so the web's per-kind icon becomes a tinted dot instead. JACKPOT is the one
// legitimate use of jackpot gold here — the notification IS about a jackpot.
const KIND_COLOR: Record<NotificationKind, string> = {
  RESULT: theme.brand,
  DEPOSIT: theme.success,
  PROMO: theme.accent,
  JACKPOT: theme.jackpot,
  SYSTEM: theme.dim,
};

function fetchNotifications(params: { limit?: number; cursor?: string } = {}): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const suffix = query.toString();
  return api.get<NotificationPage>(`/me/notifications${suffix ? `?${suffix}` : ''}`);
}

/**
 * The NUMBER part of a ledger decimal string ('500.000000'), no currency
 * mark — the templates place their own. Mirrors frontend/src/lib/money.ts
 * amountOnly().
 */
function amountOnly(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function displayParams(params: Record<string, string | number> | undefined): Record<string, string | number> {
  if (!params) return {};
  const out: Record<string, string | number> = { ...params };
  if (typeof out.amount === 'string') out.amount = amountOnly(out.amount);
  return out;
}

export function NotificationsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const list = useInfiniteQuery<NotificationPage>({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) =>
      fetchNotifications({ limit: 20, ...(pageParam ? { cursor: String(pageParam) } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
    retry: 1,
  });

  const markRead = useMutation({
    mutationFn: () => api.post<{ marked: number }>('/me/notifications/read', {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = list.data?.pages[0]?.unread ?? 0;

  // Once, on arrival, and only when there is something to clear — re-running
  // it on every render would fire a write per refetch.
  useEffect(() => {
    if (unread > 0 && !markRead.isPending) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread > 0]);

  return (
    <Screen
      query={list}
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
  rowTitle: { color: theme.text, fontSize: 13, fontWeight: '700' },
  rowTitleRead: { color: theme.dim, fontWeight: '400' },
  rowDate: { color: theme.dim, fontSize: 10 },
  unreadDot: { marginTop: 6, width: 7, height: 7, borderRadius: radius.pill, backgroundColor: theme.brand },
});
