import { Schema, model } from 'mongoose';
import { getSettings } from '../settings/player-settings';

/**
 * In-app notifications.
 *
 * Categories map onto the toggles in Settings, and the preference is honoured at
 * WRITE time rather than on read. A player who turned promos off should not have
 * marketing sitting in a table waiting for them to change their mind — declining
 * to be marketed to is a decision about whether we hold the message, not just
 * whether we show it today.
 *
 * Results and deposits work the same way for a simpler reason: if someone has
 * asked not to be told, storing the telling and hiding it is a distinction
 * without a difference.
 *
 * Not money. A notification is a record that something happened; it never moves
 * a balance and must never be the only record of one — the ledger is that.
 */

export type NotificationKind = 'RESULT' | 'DEPOSIT' | 'PROMO' | 'JACKPOT' | 'SYSTEM';

/** Which Settings toggle governs each kind. SYSTEM is never suppressible. */
const GOVERNED_BY: Record<NotificationKind, 'notifyResults' | 'notifyDeposits' | 'notifyPromos' | null> = {
  RESULT: 'notifyResults',
  DEPOSIT: 'notifyDeposits',
  PROMO: 'notifyPromos',
  // A jackpot win is a result the player would be furious to miss, and is
  // grouped with results rather than given a toggle nobody would think to find.
  JACKPOT: 'notifyResults',
  // Security and account notices. Deliberately not suppressible: "your
  // withdrawal address changed" is not marketing.
  SYSTEM: null,
};

interface NotificationDoc {
  _id: string;
  playerId: string;
  kind: NotificationKind;
  /** Translation key, not prose — the player's language is chosen at read time. */
  titleKey: string;
  /** Interpolation values for the key. Small and JSON-safe by construction. */
  params: Record<string, string | number>;
  readAt: Date | null;
  createdAt: Date;
}

const schema = new Schema<NotificationDoc>(
  {
    _id: { type: String, required: true },
    playerId: { type: String, required: true, index: true },
    kind: { type: String, required: true },
    titleKey: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'notifications' },
);

export const NotificationModel = model<NotificationDoc>('Notification', schema);

export interface Notification {
  id: string;
  kind: NotificationKind;
  titleKey: string;
  params: Record<string, string | number>;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  notifications: Notification[];
  unread: number;
  nextCursor: string | null;
}

/**
 * Raise a notification, honouring the player's preferences.
 *
 * `eventId` makes it idempotent: settlement retries and replayed queue messages
 * are normal, and a player seeing the same win announced three times would
 * reasonably assume they had won three times.
 *
 * Returns whether it was stored, so a caller can tell "suppressed by preference"
 * from "written" without inferring it.
 */
export async function notify(input: {
  playerId: string;
  kind: NotificationKind;
  titleKey: string;
  eventId: string;
  params?: Record<string, string | number>;
}): Promise<boolean> {
  const toggle = GOVERNED_BY[input.kind];
  if (toggle !== null) {
    const settings = await getSettings(input.playerId);
    if (!settings[toggle]) return false;
  }

  await NotificationModel.updateOne(
    { _id: input.eventId },
    {
      $setOnInsert: {
        _id: input.eventId,
        playerId: input.playerId,
        kind: input.kind,
        titleKey: input.titleKey,
        params: input.params ?? {},
        readAt: null,
      },
    },
    { upsert: true },
  );
  return true;
}

export async function listNotifications(
  playerId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<NotificationPage> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const before = options.cursor ? new Date(options.cursor) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    throw new RangeError('cursor must be an ISO timestamp');
  }

  const query: Record<string, unknown> = { playerId };
  if (before) query.createdAt = { $lt: before };

  // One extra row tells us whether another page exists, without a count query.
  const rows = await NotificationModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  return {
    notifications: page.map((n) => ({
      id: n._id,
      kind: n.kind,
      titleKey: n.titleKey,
      params: n.params,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    })),
    // Counted across everything, not just this page — the badge is about the
    // account, not about how far the player has scrolled.
    unread: await NotificationModel.countDocuments({ playerId, readAt: null }),
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1]!.createdAt.toISOString() : null,
  };
}

export async function unreadCount(playerId: string): Promise<number> {
  return NotificationModel.countDocuments({ playerId, readAt: null });
}

/** Mark specific notifications read, or all of them when no ids are given. */
export async function markRead(playerId: string, ids?: string[]): Promise<number> {
  const filter: Record<string, unknown> = { playerId, readAt: null };
  // Scoped to the caller either way: an id belonging to someone else simply
  // matches nothing rather than marking their notification read.
  if (ids && ids.length > 0) filter._id = { $in: ids };

  const result = await NotificationModel.updateMany(filter, { $set: { readAt: new Date() } });
  return result.modifiedCount;
}
