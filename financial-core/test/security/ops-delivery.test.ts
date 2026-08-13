import { formatSyslog, syslogConfig, type SyslogConfig } from '../../src/security/syslog';
import {
  telegramAlertHandler,
  telegramAlertConfig,
  formatAlert,
  ALERT_WINDOW_MS,
} from '../../src/lib/telegram-alert';

/**
 * Ops delivery (SAMUEL.md task 4) — getting security events off the machine.
 *
 * The syslog format is a contract with a collector that will silently drop a
 * malformed line, which fails in exactly the same way as no events happening.
 * The rate limiting matters because an incident produces hundreds of identical
 * alerts, and an unlimited handler floods the chat until Telegram throttles the
 * bot — silencing the later messages, which are the ones somebody is finally
 * watching for.
 */

const CFG: SyslogConfig = { host: 'logs.test', port: 514, appName: 'financial-core' };

const event = (name: string): { event: string; detail: Record<string, unknown>; at: Date; id: string } => ({
  id: 'evt-1',
  event: name,
  detail: { txHash: 'abc', amount: '500.00' },
  at: new Date('2026-08-15T10:30:00.000Z'),
});

describe('syslog framing', () => {
  it('emits a well-formed RFC 5424 line', () => {
    const line = formatSyslog(CFG, event('ILLEGAL_FUND_FLOW'), 1);
    const [pri, ...rest] = line.split(' ');

    // local0 (16) * 8 + alert (1) = 129.
    expect(pri).toBe('<129>1');
    expect(rest[0]).toBe('2026-08-15T10:30:00.000Z');
    expect(line).toContain('financial-core');
    expect(line).toContain('ILLEGAL_FUND_FLOW');
  });

  it('carries the detail as parseable JSON', () => {
    // A collector should be able to index on the payload, not scrape a string.
    const line = formatSyslog(CFG, event('CIRCUIT_BREAKER_CB6'), 1);
    const payload = JSON.parse(line.slice(line.indexOf('{')));
    expect(payload.detail.txHash).toBe('abc');
    expect(payload.id).toBe('evt-1');
  });

  it('is unconfigured by default', () => {
    // No SYSLOG_HOST means no shipping, and that is the dev default rather than
    // a failure — the same shape as SMTP and the bot token.
    expect(syslogConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(syslogConfig({ SYSLOG_HOST: 'logs.test' } as NodeJS.ProcessEnv)).toEqual({
      host: 'logs.test',
      port: 514,
      appName: 'financial-core',
    });
  });
});

describe('telegram ops alerts', () => {
  const cfg = { botToken: 'test-token', chatId: '-100999' };

  const spy = (): { calls: Record<string, unknown>[]; impl: typeof fetch } => {
    const calls: Record<string, unknown>[] = [];
    const impl = (async (_url: unknown, init: { body?: unknown } | undefined) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return { ok: true, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    return { calls, impl };
  };

  it('sends to the configured OPS chat, never a player', async () => {
    const { calls, impl } = spy();
    await telegramAlertHandler(cfg, { fetchImpl: impl })('CB6 tripped', { path: 'TREASURY→PLAYER' });

    expect(calls[0]!.chat_id).toBe('-100999');
    expect(String(calls[0]!.text)).toContain('CB6 tripped');
    expect(String(calls[0]!.text)).toContain('TREASURY→PLAYER');
  });

  it('collapses a storm of identical alerts into one', async () => {
    // What a real incident looks like. Four hundred messages would be throttled
    // by Telegram, and the ones dropped are the later ones.
    const { calls, impl } = spy();
    const handler = telegramAlertHandler(cfg, { fetchImpl: impl, now: () => 1_000 });

    for (let i = 0; i < 50; i += 1) await handler('CB6 tripped');
    expect(calls).toHaveLength(1);
  });

  it('reports how many it swallowed when the window reopens', async () => {
    const { calls, impl } = spy();
    let clock = 1_000;
    const handler = telegramAlertHandler(cfg, { fetchImpl: impl, now: () => clock });

    await handler('CB6 tripped');
    for (let i = 0; i < 9; i += 1) await handler('CB6 tripped');

    clock += ALERT_WINDOW_MS + 1;
    await handler('CB6 tripped');

    expect(calls).toHaveLength(2);
    // An operator seeing one message during an incident that produced ten would
    // badly misjudge its size.
    expect(String(calls[1]!.text)).toContain('+9 more');
  });

  it('does not let one alert silence a different one', async () => {
    const { calls, impl } = spy();
    const handler = telegramAlertHandler(cfg, { fetchImpl: impl, now: () => 1_000 });

    await handler('CB6 tripped');
    await handler('CB4 tripped');
    expect(calls).toHaveLength(2);
  });

  it('falls back to stderr rather than losing the alert', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => void logged.push(args);

    try {
      // Must not throw: alertOps is called from inside circuit breakers, and a
      // breaker that fails because its notifier is down is worse than a missed
      // message.
      await expect(
        telegramAlertHandler(cfg, { fetchImpl: down })('CB6 tripped'),
      ).resolves.toBeUndefined();
      expect(JSON.stringify(logged)).toContain('CB6 tripped');
    } finally {
      console.error = original;
    }
  });

  it('is unconfigured without both a token and a chat id', () => {
    expect(telegramAlertConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      telegramAlertConfig({ TELEGRAM_BOT_TOKEN: 't' } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      telegramAlertConfig({
        TELEGRAM_BOT_TOKEN: 't',
        OPS_TELEGRAM_CHAT_ID: '-1',
      } as NodeJS.ProcessEnv),
    ).toEqual({ botToken: 't', chatId: '-1' });
  });

  it('escapes HTML so a hostile value cannot become markup', () => {
    const text = formatAlert('trip', { path: '<b>x</b>' });
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
