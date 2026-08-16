import {
  sendTelegram,
  chatIdOf,
  TelegramSendModel,
} from '../../src/notifications/telegram/send-telegram';
import {
  esc,
  amount,
  depositReceived,
  withdrawalRequested,
  nonOfficialContract,
} from '../../src/notifications/telegram/messages';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * Telegram money notifications — the spec's actual channel.
 *
 * The specs never mention email; they name TG throughout, with a measured
 * budget ("tap to TG notification <15 seconds") and an explicit failure case
 * ("wrong contract → no credit, TG notification sent").
 *
 * What matters here is the same thing that mattered for email: one message per
 * event, and never failing the money.
 */

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(TelegramSendModel);
});
afterAll(stopTestDb);
afterEach(clearCollections);

const ok = (async () => ({
  ok: true,
  json: async () => ({ ok: true }),
})) as unknown as typeof fetch;

describe('chatIdOf', () => {
  it('reads the chat id straight out of a Telegram playerId', () => {
    // This is why TG has no address problem: the destination is already in the
    // id every money event carries.
    expect(chatIdOf('tg-4471')).toBe('4471');
  });

  it('returns null for a web account', () => {
    // Web sign-ups have no Telegram to reach; they get email instead.
    expect(chatIdOf('065f2a1c-9d3e-4f11-8a77-2b6c0e1d4f90')).toBeNull();
    expect(chatIdOf('tg-not-a-number')).toBeNull();
  });
});

describe('sendTelegram', () => {
  const TOKEN = 'test-bot-token';

  it('sends to the chat id derived from the playerId', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const spy = (async (url: unknown, init: { body?: unknown } | undefined) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return { ok: true, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;

    const result = await sendTelegram('tg-4471', 'hello', 'e-1', {
      botToken: TOKEN,
      fetchImpl: spy,
    });

    expect(result).toBe('sent');
    expect(calls[0]!.url).toContain(`/bot${TOKEN}/sendMessage`);
    expect(calls[0]!.body.chat_id).toBe('4471');
  });

  it('sends once per event, however many times it is retried', async () => {
    // Settlement retries and replayed queue messages are normal. A player must
    // not get three messages because a dyno restarted mid-credit.
    const first = await sendTelegram('tg-1', 'x', 'e-dup', { botToken: TOKEN, fetchImpl: ok });
    const second = await sendTelegram('tg-1', 'x', 'e-dup', { botToken: TOKEN, fetchImpl: ok });

    expect(first).toBe('sent');
    expect(second).toBe('duplicate');
    expect(await TelegramSendModel.countDocuments({ _id: 'e-dup' })).toBe(1);
  });

  it('survives two processes racing the same event', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        sendTelegram('tg-1', 'x', 'e-race', { botToken: TOKEN, fetchImpl: ok }),
      ),
    );
    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
  });

  it('releases the claim when the send fails, so a retry can still deliver', async () => {
    // A Telegram outage must not permanently suppress a receipt the player
    // should have had.
    const broken = (async () => ({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, description: 'Bad Gateway' }),
    })) as unknown as typeof fetch;

    expect(await sendTelegram('tg-9', 'x', 'e-retry', { botToken: TOKEN, fetchImpl: broken })).toBe(
      'failed',
    );
    expect(await TelegramSendModel.countDocuments({ _id: 'e-retry' })).toBe(0);

    // Later, once Telegram is back.
    expect(await sendTelegram('tg-9', 'x', 'e-retry', { botToken: TOKEN, fetchImpl: ok })).toBe(
      'sent',
    );
  });

  it('does nothing for a web account rather than erroring', async () => {
    expect(await sendTelegram('web-uuid', 'x', 'e-web', { botToken: TOKEN, fetchImpl: ok })).toBe(
      'not_telegram',
    );
  });

  it('does nothing without a bot token — the dev default', async () => {
    // No token means money paths run normally and send nothing, exactly as the
    // email transport behaves without SMTP.
    expect(await sendTelegram('tg-1', 'x', 'e-noconf', { botToken: '', fetchImpl: ok })).toBe(
      'not_configured',
    );
    expect(await TelegramSendModel.countDocuments({})).toBe(0);
  });

  it('reports a refusal from Telegram rather than claiming success', async () => {
    const refused = (async () => ({
      ok: true,
      json: async () => ({ ok: false, description: 'chat not found' }),
    })) as unknown as typeof fetch;

    // HTTP 200 with ok:false is Telegram's way of refusing. Treating that as
    // sent would mark the event delivered and suppress every later attempt.
    expect(await sendTelegram('tg-1', 'x', 'e-refused', { botToken: TOKEN, fetchImpl: refused })).toBe(
      'failed',
    );
    expect(await TelegramSendModel.countDocuments({ _id: 'e-refused' })).toBe(0);
  });
});

describe('message bodies', () => {
  it('escapes HTML so a hostile value cannot become markup', () => {
    // parse_mode is HTML, so an unescaped `<` breaks the message at best.
    expect(esc('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
  });

  it('truncates rather than rounds the amount', () => {
    // A receipt must not claim a cent the ledger did not move.
    expect(amount('20.999999')).toBe('₮20.99');
    expect(amount('20')).toBe('₮20.00');
    expect(amount('0.5')).toBe('₮0.50');
  });

  it('states the amount and that the funds are usable', () => {
    const body = depositReceived({ amount: '500.000000', txHash: 'abc' });
    expect(body).toContain('₮500.00 received');
    expect(body).toContain('abc');
  });

  it('tells a withdrawal recipient what to do if it was not them', () => {
    // This is the message that reaches someone whose account was used without
    // them. Saying only what happened is not enough.
    const body = withdrawalRequested({ amount: '100', address: 'TXaddr' });
    expect(body).toMatch(/wasn't you/i);
    expect(body).toContain('TXaddr');
  });

  it('tells a wrong-contract sender to contact support, with the tx id', () => {
    // They have sent real funds nowhere useful. Silence would leave them
    // waiting for a deposit that is never coming.
    const body = nonOfficialContract({ txHash: 'deadbeef' });
    expect(body).toMatch(/not credited/i);
    expect(body).toMatch(/support/i);
    expect(body).toContain('deadbeef');
  });
});
