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

export type NotificationKind =
  | 'RESULT'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'PROMO'
  | 'JACKPOT'
  | 'SYSTEM';

/**
 * Which Settings toggle governs each kind. SYSTEM is never suppressible.
 *
 * Exported because the toggle governs the CHANNELS too, not just this table:
 * money-mail's announce() reads it before sending on Telegram or by email. One
 * table, consulted twice — a second literal `notifyDeposits` sitting next to a
 * send call is the copy that eventually disagrees with this one.
 */
export const GOVERNED_BY: Record<NotificationKind, 'notifyResults' | 'notifyDeposits' | 'notifyPromos' | null> = {
  RESULT: 'notifyResults',
  DEPOSIT: 'notifyDeposits',
  PROMO: 'notifyPromos',
  // A jackpot win is a result the player would be furious to miss, and is
  // grouped with results rather than given a toggle nobody would think to find.
  JACKPOT: 'notifyResults',
  /*
   * Money OUT, and never suppressible - the null is the whole point.
   *
   * These used to be SYSTEM, which got the suppressibility right and the
   * filing wrong: a player hunting for their withdrawal found it next to
   * "your address was changed" instead of with their money. Splitting it
   * out lets the Messages screen file it under Money while keeping the
   * guarantee that matters - "your withdrawal was sent" is how somebody
   * notices their account being drained, so it cannot be behind a toggle.
   *
   * Which is why this is a new kind rather than a move to DEPOSIT: DEPOSIT
   * answers to notifyDeposits, and that would have quietly made the alarm
   * mutable.
   */
  WITHDRAWAL: null,
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
  /**
   * Unread per kind, across the whole account — every kind is present, zeros
   * included, so a caller can render a tab strip without knowing which kinds
   * exist in the data.
   *
   * Separate from `unread` on purpose. `unread` answers "is there anything for
   * me", which is the bell; this answers "which tab should wear a badge", and
   * summing these is NOT guaranteed to give you the other if a kind is ever
   * added to NotificationKind without being added here — the Record type makes
   * that a compile error rather than a quietly wrong badge.
   */
  unreadByKind: Record<NotificationKind, number>;
}

/** Every kind, so callers can rely on the key being present rather than optional. */
const ALL_KINDS: NotificationKind[] = [
  'RESULT',
  'DEPOSIT',
  'WITHDRAWAL',
  'PROMO',
  'JACKPOT',
  'SYSTEM',
];

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

/**
 * A page of a player's notifications, newest first.
 *
 * `kinds` filters server-side, and it has to be server-side: the client pages
 * through this with a cursor, so a tab filtering whatever happened to be
 * fetched would look empty purely because the reader had not scrolled far
 * enough, and its badge would count the wrong thing. A screen that lies
 * quietly is worse than one that admits it cannot filter.
 *
 * An empty `kinds` array means "no kinds", not "all kinds" — it returns
 * nothing. Callers wanting everything omit the option. That distinction is
 * deliberate: `[]` arriving from a caller that meant to build a filter and
 * built an empty one should show an empty list, not silently show everything.
 */
export async function listNotifications(
  playerId: string,
  options: { limit?: number; cursor?: string; kinds?: NotificationKind[] } = {},
): Promise<NotificationPage> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  const before = options.cursor ? new Date(options.cursor) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    throw new RangeError('cursor must be an ISO timestamp');
  }

  const query: Record<string, unknown> = { playerId };
  if (before) query.createdAt = { $lt: before };
  // `undefined` means unfiltered; `[]` means none. See the note above.
  if (options.kinds !== undefined) query.kind = { $in: options.kinds };

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
    // account, not about how far the player has scrolled. Note it also ignores
    // `kinds`: the bell counts the account, not the open tab.
    unread: await NotificationModel.countDocuments({ playerId, readAt: null }),
    unreadByKind: await unreadByKind(playerId),
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1]!.createdAt.toISOString() : null,
  };
}

export async function unreadCount(playerId: string): Promise<number> {
  return NotificationModel.countDocuments({ playerId, readAt: null });
}

/**
 * Unread counts per kind, in one aggregation rather than one query per kind.
 *
 * Kinds with nothing unread are absent from the aggregation's output, so the
 * result is seeded with zeros first — otherwise a tab with no unread messages
 * would read `undefined` and render an empty badge instead of no badge.
 */
export async function unreadByKind(playerId: string): Promise<Record<NotificationKind, number>> {
  const rows = await NotificationModel.aggregate<{ _id: NotificationKind; n: number }>([
    { $match: { playerId, readAt: null } },
    { $group: { _id: '$kind', n: { $sum: 1 } } },
  ]);

  const counts = Object.fromEntries(ALL_KINDS.map((k) => [k, 0])) as Record<
    NotificationKind,
    number
  >;
  for (const row of rows) {
    // A kind retired from the union but still present in old documents would
    // otherwise add a key the type says cannot be there.
    if (row._id in counts) counts[row._id] = row.n;
  }
  return counts;
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
