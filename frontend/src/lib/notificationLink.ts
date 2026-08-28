/**
 * Which transaction a notification is about.
 *
 * Notification ids are the event ids financial-core announces under, and they
 * already carry the reference:
 *
 *   deposit:<txHash>                    → the deposit ledger's businessId
 *   withdrawal:<id>:requested | :sent   → the withdrawal ledger's businessId
 *
 * So the link needs no new field on the notification and no second request —
 * the id IS the join key to `/me/transactions`.
 *
 * The cost is that an id FORMAT becomes load-bearing. That is a real trade and
 * the reason this lives in one function with a test rather than inline in a
 * component: if financial-core ever changes how it composes an event id, this
 * is the single place that breaks, and it fails closed — an unrecognised id
 * returns null and the row simply is not a link.
 *
 * Jackpot and system notices have no ledger row to point at, so they get null.
 */
export function txnRefFromEventId(id: string): string | null {
  const parts = id.split(':');
  const kind = parts[0];
  const ref = parts[1];
  if (!ref) return null;
  return kind === 'deposit' || kind === 'withdrawal' ? ref : null;
}
