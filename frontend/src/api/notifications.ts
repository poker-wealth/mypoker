import { api } from './client';

/** In-app notifications. Mirrors financial-core/src/notifications. */

export type NotificationKind = 'RESULT' | 'DEPOSIT' | 'PROMO' | 'JACKPOT' | 'SYSTEM';

export interface Notification {
  id: string;
  kind: NotificationKind;
  /** A translation key — the server never sends prose. */
  titleKey: string;
  params: Record<string, string | number>;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  notifications: Notification[];
  /** Across the account, not just this page — and not just the open tab. */
  unread: number;
  nextCursor: string | null;
  /** Unread per kind, every kind present with zeros. Drives the tab badges. */
  unreadByKind: Record<NotificationKind, number>;
}

/**
 * The Messages tabs, and which kinds each one holds.
 *
 * JACKPOT sits under Results because the server already decided that:
 * financial-core's GOVERNED_BY groups it with `notifyResults`, reasoning that
 * "a jackpot win is a result the player would be furious to miss". A second
 * grouping here that disagreed with that one would eventually drift.
 */
export const MESSAGE_TABS = [
  { id: 'system', kinds: ['SYSTEM'] },
  { id: 'results', kinds: ['RESULT', 'JACKPOT'] },
  { id: 'deposits', kinds: ['DEPOSIT'] },
  { id: 'promos', kinds: ['PROMO'] },
] as const satisfies ReadonlyArray<{ id: string; kinds: readonly NotificationKind[] }>;

export type MessageTabId = (typeof MESSAGE_TABS)[number]['id'];

export function fetchNotifications(
  params: { limit?: number; cursor?: string; kinds?: readonly NotificationKind[] } = {},
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

/** Omit ids to mark everything read. */
export const markNotificationsRead = (ids?: string[]): Promise<{ marked: number }> =>
  api.post<{ marked: number }>('/me/notifications/read', ids ? { ids } : {});
