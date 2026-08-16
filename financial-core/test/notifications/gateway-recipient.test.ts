import { gatewayRecipientResolver } from '../../src/notifications/email/gateway-recipient';

/**
 * Resolving an email address by asking the gateway.
 *
 * The property that matters is not that it finds addresses — it is that it
 * NEVER throws. This runs inside the deposit and withdrawal paths, and a
 * lookup that rejects would have to be caught by every caller to avoid taking
 * a credit down with it. Returning null instead means the failure is already
 * the normal "no email" case.
 */

const resolver = (fetchImpl: typeof fetch, timeoutMs?: number) =>
  gatewayRecipientResolver({
    gatewayUrl: 'http://gateway.test/',
    internalSecret: 'shhh',
    fetchImpl,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

describe('gatewayRecipientResolver', () => {
  it('returns the address the gateway reports', async () => {
    const calls: { url: string; secret: string }[] = [];
    const spy = (async (url: unknown, init: { headers?: Record<string, string> } | undefined) => {
      calls.push({ url: String(url), secret: init?.headers?.['x-internal-secret'] ?? '' });
      return { ok: true, json: async () => ({ email: 'p@example.com' }) };
    }) as unknown as typeof fetch;

    expect(await resolver(spy)('web-1')).toBe('p@example.com');
    expect(calls[0]!.url).toBe('http://gateway.test/internal/players/web-1/email');
    // The service secret, not a player token — this is service-to-service.
    expect(calls[0]!.secret).toBe('shhh');
  });

  it('never asks about a Telegram player', async () => {
    // Their chat id is in the playerId; there is no mailbox to find, and a
    // request per deposit for the majority of players would be pure waste.
    let called = false;
    const spy = (async () => {
      called = true;
      return { ok: true, json: async () => ({ email: null }) };
    }) as unknown as typeof fetch;

    expect(await resolver(spy)('tg-4471')).toBeNull();
    expect(called).toBe(false);
  });

  it('returns null — never throws — when the gateway is unreachable', async () => {
    // The whole point. This runs inside a money path.
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(resolver(down)('web-1')).resolves.toBeNull();
  });

  it('returns null on a non-200', async () => {
    const rejected = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(resolver(rejected)('web-1')).resolves.toBeNull();
  });

  it('returns null on a malformed body rather than a broken address', async () => {
    const garbage = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(resolver(garbage)('web-1')).resolves.toBeNull();
  });

  it('gives up rather than holding a money path open', async () => {
    // A hung gateway must not stall a credit. The abort surfaces as null.
    const hangs = ((_url: unknown, init: { signal?: AbortSignal } | undefined) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;

    await expect(resolver(hangs, 20)('web-1')).resolves.toBeNull();
  });
});
