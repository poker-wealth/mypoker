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
  /** Across the account, not just this page. */
  unread: number;
  nextCursor: string | null;
}

export function fetchNotifications(
  params: { limit?: number; cursor?: string } = {},
): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const suffix = query.toString();
  return api.get<NotificationPage>(`/me/notifications${suffix ? `?${suffix}` : ''}`);
}

/** Omit ids to mark everything read. */
export const markNotificationsRead = (ids?: string[]): Promise<{ marked: number }> =>
  api.post<{ marked: number }>('/me/notifications/read', ids ? { ids } : {});
