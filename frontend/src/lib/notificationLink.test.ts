import { describe, it, expect } from 'vitest';
import { txnRefFromEventId } from './notificationLink';

/**
 * The id format is load-bearing for this link, so it is pinned here. If
 * financial-core changes how it composes an event id, this test is the thing
 * that says so — rather than a notification that silently stops opening.
 */
describe('txnRefFromEventId', () => {
  it('pulls the tx hash out of a deposit event', () => {
    expect(txnRefFromEventId('deposit:1a0a5123594d19120b292e49')).toBe('1a0a5123594d19120b292e49');
  });

  it('pulls the withdrawal id out of both of its events', () => {
    // Two notifications, one withdrawal — both must land on the same row.
    expect(txnRefFromEventId('withdrawal:wd-42:requested')).toBe('wd-42');
    expect(txnRefFromEventId('withdrawal:wd-42:sent')).toBe('wd-42');
  });

  it('returns null for events with no ledger row to open', () => {
    expect(txnRefFromEventId('jackpot:round-9')).toBeNull();
    expect(txnRefFromEventId('promo:summer')).toBeNull();
  });

  it('fails closed on anything malformed', () => {
    // An unrecognised id makes the row a plain row, never a broken link.
    expect(txnRefFromEventId('deposit')).toBeNull();
    expect(txnRefFromEventId('')).toBeNull();
    expect(txnRefFromEventId('deposit:')).toBeNull();
  });
});
