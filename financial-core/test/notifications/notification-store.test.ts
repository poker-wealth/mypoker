import {
  notify,
  listNotifications,
  unreadCount,
  markRead,
  NotificationModel,
} from '../../src/notifications/notification-store';
import { updateSettings } from '../../src/settings/player-settings';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';

const PLAYER = 'tg-notify-test';
const OTHER = 'tg-someone-else';

beforeAll(startTestDb);
afterAll(stopTestDb);
afterEach(clearCollections);

const raise = (over: Partial<Parameters<typeof notify>[0]> = {}) =>
  notify({
    playerId: PLAYER,
    kind: 'RESULT',
    titleKey: 'notifications.handWon',
    eventId: `evt-${Math.random()}`,
    ...over,
  });

describe('raising notifications', () => {
  it('stores one and counts it unread', async () => {
    expect(await raise()).toBe(true);
    expect(await unreadCount(PLAYER)).toBe(1);
  });

  it('stores a translation key, not prose', async () => {
    await raise({ titleKey: 'notifications.handWon', params: { amount: '12.50' } });
    const [n] = (await listNotifications(PLAYER)).notifications;

    // The player's language is chosen when they read it, not when it was
    // raised — a settled hand at 3am should not fix the wording forever.
    expect(n!.titleKey).toBe('notifications.handWon');
    expect(n!.params).toEqual({ amount: '12.50' });
  });

  it('will not raise the same event twice', async () => {
    await raise({ eventId: 'evt-fixed' });
    await raise({ eventId: 'evt-fixed' });

    // Settlement retries are normal. A player seeing one win announced three
    // times would reasonably assume they had won three times.
    expect(await NotificationModel.countDocuments({ playerId: PLAYER })).toBe(1);
  });
});

describe('preferences are honoured at write time', () => {
  it('suppresses a promo when the player has promos off', async () => {
    // Off by default — an opt-out is not consent.
    expect(await raise({ kind: 'PROMO', titleKey: 'notifications.promo' })).toBe(false);
    expect(await NotificationModel.countDocuments({ playerId: PLAYER })).toBe(0);
  });

  it('stores a promo once the player opts in', async () => {
    await updateSettings(PLAYER, { notifyPromos: true });
    expect(await raise({ kind: 'PROMO', titleKey: 'notifications.promo' })).toBe(true);
  });

  it('suppresses results when that toggle is off', async () => {
    await updateSettings(PLAYER, { notifyResults: false });
    expect(await raise({ kind: 'RESULT' })).toBe(false);
  });

  it('suppresses deposits when that toggle is off', async () => {
    await updateSettings(PLAYER, { notifyDeposits: false });
    expect(await raise({ kind: 'DEPOSIT', titleKey: 'notifications.deposit' })).toBe(false);
  });

  it('groups a jackpot win under results rather than a toggle nobody would find', async () => {
    await updateSettings(PLAYER, { notifyResults: false });
    expect(await raise({ kind: 'JACKPOT', titleKey: 'notifications.jackpot' })).toBe(false);
  });

  it('never suppresses a SYSTEM notice', async () => {
    // Security and account notices. "Your withdrawal address changed" is not
    // marketing and must not be silenceable.
    await updateSettings(PLAYER, {
      notifyResults: false,
      notifyDeposits: false,
      notifyPromos: false,
    });
    expect(await raise({ kind: 'SYSTEM', titleKey: 'notifications.addressChanged' })).toBe(true);
  });

  it('does not retroactively deliver what was suppressed', async () => {
    await updateSettings(PLAYER, { notifyResults: false });
    await raise({ kind: 'RESULT' });
    await updateSettings(PLAYER, { notifyResults: true });

    // Declining to be told is a decision about whether we hold the message, not
    // just whether we show it today.
    expect((await listNotifications(PLAYER)).notifications).toHaveLength(0);
  });
});

describe('reading', () => {
  beforeEach(async () => {
    for (let i = 0; i < 5; i++) await raise({ eventId: `evt-${i}` });
  });

  it('returns newest first', async () => {
    const { notifications } = await listNotifications(PLAYER);
    const times = notifications.map((n) => n.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('pages with a cursor', async () => {
    const first = await listNotifications(PLAYER, { limit: 2 });
    expect(first.notifications).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listNotifications(PLAYER, { limit: 2, cursor: first.nextCursor! });
    const ids = new Set([...first.notifications, ...second.notifications].map((n) => n.id));
    expect(ids.size).toBe(4); // no overlap between pages
  });

  it('rejects a malformed cursor rather than silently returning page one', async () => {
    await expect(listNotifications(PLAYER, { cursor: 'not-a-date' })).rejects.toThrow(RangeError);
  });

  it('counts unread across everything, not just the current page', async () => {
    const page = await listNotifications(PLAYER, { limit: 2 });
    // The badge is about the account, not how far the player has scrolled.
    expect(page.unread).toBe(5);
  });
});

describe('marking read', () => {
  beforeEach(async () => {
    for (let i = 0; i < 3; i++) await raise({ eventId: `evt-${i}` });
  });

  it('marks everything when given no ids', async () => {
    expect(await markRead(PLAYER)).toBe(3);
    expect(await unreadCount(PLAYER)).toBe(0);
  });

  it('marks only the ids given', async () => {
    expect(await markRead(PLAYER, ['evt-0'])).toBe(1);
    expect(await unreadCount(PLAYER)).toBe(2);
  });

  it('is idempotent', async () => {
    await markRead(PLAYER, ['evt-0']);
    expect(await markRead(PLAYER, ['evt-0'])).toBe(0);
  });

  it('cannot mark another player’s notification read', async () => {
    await notify({ playerId: OTHER, kind: 'SYSTEM', titleKey: 'x', eventId: 'their-evt' });

    // Scoped to the caller: someone else's id matches nothing rather than
    // reaching across accounts.
    expect(await markRead(PLAYER, ['their-evt'])).toBe(0);
    expect(await unreadCount(OTHER)).toBe(1);
  });
});

describe('isolation between players', () => {
  it('never returns another player’s notifications', async () => {
    await raise();
    await notify({ playerId: OTHER, kind: 'SYSTEM', titleKey: 'x', eventId: 'theirs' });

    const mine = await listNotifications(PLAYER);
    expect(mine.notifications.every((n) => n.id !== 'theirs')).toBe(true);
    expect(mine.unread).toBe(1);
  });
});
