import {
  registerPushToken,
  forgetPushToken,
  devicesFor,
  PushTokenModel,
} from '../../src/notifications/push/push-token-store';
import { sendPush, pushFromTelegram, PushSendModel } from '../../src/notifications/push/send-push';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';

const PLAYER = 'tg-push-test';
const OTHER = 'tg-someone-else';
const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN2 = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

beforeAll(startTestDb);
afterAll(stopTestDb);
afterEach(clearCollections);

/** Expo's response shape: one ticket per message, in the order sent. */
const expoOk = (n: number): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ data: Array.from({ length: n }, () => ({ status: 'ok' })) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

const expoTickets = (tickets: unknown[]): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ data: tickets }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

const expoDown: typeof fetch = (async () => {
  throw new Error('exp.host unreachable');
}) as unknown as typeof fetch;

const MSG = { title: '$120.00 received', body: 'Your deposit has been credited.' };
const SENT = { accessToken: 'test-access-token' };

describe('the device address book', () => {
  it('registers a device and hands it back', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');
    expect(await devicesFor(PLAYER)).toEqual([{ token: TOKEN, platform: 'android' }]);
  });

  it('is idempotent — the app re-registers on every launch', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');
    await registerPushToken(PLAYER, TOKEN, 'android');
    expect(await devicesFor(PLAYER)).toHaveLength(1);
  });

  it('gives a player with a phone and a tablet two devices', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');
    await registerPushToken(PLAYER, TOKEN2, 'ios');
    expect(await devicesFor(PLAYER)).toHaveLength(2);
  });

  it('MOVES a re-registered token to the new player, never duplicates it', async () => {
    // The shared or resold handset. If the old row survived, the previous
    // owner's deposit notices would keep arriving on someone else's phone.
    await registerPushToken(PLAYER, TOKEN, 'android');
    await registerPushToken(OTHER, TOKEN, 'android');

    expect(await devicesFor(PLAYER)).toEqual([]);
    expect(await devicesFor(OTHER)).toEqual([{ token: TOKEN, platform: 'android' }]);
    expect(await PushTokenModel.countDocuments({})).toBe(1);
  });

  it('forgets a device on sign-out', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');
    await forgetPushToken(TOKEN);
    expect(await devicesFor(PLAYER)).toEqual([]);
  });

  it('never hands one player another player’s devices', async () => {
    await registerPushToken(OTHER, TOKEN2, 'ios');
    expect(await devicesFor(PLAYER)).toEqual([]);
  });
});

describe('sending', () => {
  it('sends nothing at all without an access token', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');
    const fetchImpl = jest.fn();
    // The dev default. Money paths run normally and no HTTP call is made —
    // the same shape as Telegram and email without their credentials.
    expect(await sendPush(PLAYER, MSG, 'evt-1', { fetchImpl: fetchImpl as never })).toBe(
      'not_configured',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports no_devices for a player who never installed the app', async () => {
    const fetchImpl = jest.fn();
    expect(
      await sendPush(PLAYER, MSG, 'evt-1', { ...SENT, fetchImpl: fetchImpl as never }),
    ).toBe('no_devices');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends one message per device', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');
    await registerPushToken(PLAYER, TOKEN2, 'ios');

    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(String(init.body));
      return new Response(JSON.stringify({ data: [{ status: 'ok' }, { status: 'ok' }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    expect(await sendPush(PLAYER, MSG, 'evt-1', { ...SENT, fetchImpl })).toBe('sent');
    const body = JSON.parse(calls[0]!) as { to: string }[];
    expect(body).toHaveLength(2);
    expect(body.map((m) => m.to).sort()).toEqual([TOKEN, TOKEN2].sort());
  });

  it('pushes an event once, however many times the credit is retried', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');
    expect(await sendPush(PLAYER, MSG, 'evt-fixed', { ...SENT, fetchImpl: expoOk(1) })).toBe('sent');
    expect(await sendPush(PLAYER, MSG, 'evt-fixed', { ...SENT, fetchImpl: expoOk(1) })).toBe(
      'duplicate',
    );
  });

  it('releases the claim when the send fails, so a retry can still deliver', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');

    expect(await sendPush(PLAYER, MSG, 'evt-1', { ...SENT, fetchImpl: expoDown })).toBe('failed');
    // An Expo outage must not permanently silence a notification the player
    // should have had.
    expect(await PushSendModel.countDocuments({ _id: 'evt-1' })).toBe(0);
    expect(await sendPush(PLAYER, MSG, 'evt-1', { ...SENT, fetchImpl: expoOk(1) })).toBe('sent');
  });

  it('drops a token Expo says is uninstalled', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');
    await registerPushToken(PLAYER, TOKEN2, 'ios');

    // devicesFor's order is the send order, so read it rather than assuming.
    const order = await devicesFor(PLAYER);
    const tickets = order.map((d) =>
      d.token === TOKEN ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' },
    );

    expect(await sendPush(PLAYER, MSG, 'evt-1', { ...SENT, fetchImpl: expoTickets(tickets) })).toBe(
      'sent',
    );
    expect(await devicesFor(PLAYER)).toEqual([{ token: TOKEN2, platform: 'ios' }]);
  });

  it('prunes nothing when the ticket count does not match', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');
    await registerPushToken(PLAYER, TOKEN2, 'ios');

    // Tickets are matched to tokens BY POSITION. One ticket for two messages
    // means that assumption no longer holds, and deleting by guesswork would
    // silence a device that is working fine.
    expect(
      await sendPush(PLAYER, MSG, 'evt-1', {
        ...SENT,
        fetchImpl: expoTickets([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]),
      }),
    ).toBe('sent');
    expect(await devicesFor(PLAYER)).toHaveLength(2);
  });

  it('does not push to a device that has been forgotten', async () => {
    await registerPushToken(PLAYER, TOKEN, 'android');
    await forgetPushToken(TOKEN);
    const fetchImpl = jest.fn();
    expect(
      await sendPush(PLAYER, MSG, 'evt-1', { ...SENT, fetchImpl: fetchImpl as never }),
    ).toBe('no_devices');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('turning Telegram copy into a notification', () => {
  it('takes the headline as the title and the rest as the body', () => {
    const tg = ['<b>$120.00 received</b>', '', 'Your deposit has been credited.'].join('\n');
    expect(pushFromTelegram(tg)).toEqual({
      title: '$120.00 received',
      body: 'Your deposit has been credited.',
    });
  });

  it('puts back the entities the Telegram escaper introduced', () => {
    // A player should read `Tom & Jerry`, not `Tom &amp; Jerry`.
    const tg = ['<b>Sent</b>', '', 'To <code>Tom &amp; Jerry</code>'].join('\n');
    expect(pushFromTelegram(tg).body).toBe('To Tom & Jerry');
  });

  it('gives a one-line message a title and no body, not the sentence twice', () => {
    expect(pushFromTelegram('<b>Withdrawal sent</b>')).toEqual({
      title: 'Withdrawal sent',
      body: '',
    });
  });

  it('collapses the blank lines Telegram uses to separate paragraphs', () => {
    const tg = ['<b>Head</b>', '', 'One.', '', 'Two.'].join('\n');
    // A push body has a line or two of room; blank lines would waste half of it.
    expect(pushFromTelegram(tg).body).toBe('One. Two.');
  });
});
