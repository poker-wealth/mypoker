import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/http/app';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';

/**
 * The internal (service-secret) avatar endpoints, over real HTTP — same
 * harness as app.test.ts. Only the gateway calls these, with the shared
 * secret, never a player token; that boundary is what is under test here as
 * much as the storage itself.
 */

const INTERNAL_SECRET = 'test-internal-secret';
let server: Server;
let base: string;

function url(path: string): string {
  return `${base}${path}`;
}

const internal = { 'x-internal-secret': INTERNAL_SECRET };

describe('Financial Core /internal/avatars', () => {
  beforeAll(async () => {
    process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret';
    await startTestDb();
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}/api/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await stopTestDb();
  });

  afterEach(clearCollections);

  async function put(path: string, body: Buffer, headers: Record<string, string> = internal): Promise<Response> {
    return fetch(url(path), {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', ...headers },
      body,
    });
  }

  it('rejects a store without the internal secret', async () => {
    const res = await put('/internal/avatars/p1', Buffer.from('x'), {});
    expect(res.status).toBe(401);
  });

  it('rejects a fetch without the internal secret', async () => {
    const res = await fetch(url('/internal/avatars/p1'));
    expect(res.status).toBe(401);
  });

  it('stores bytes and reads them back with X-Avatar-Updated-At', async () => {
    const bytes = Buffer.from('a-small-fake-jpeg');
    const putRes = await put('/internal/avatars/p-store-1', bytes);
    expect(putRes.status).toBe(204);

    const getRes = await fetch(url('/internal/avatars/p-store-1'), { headers: internal });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('x-avatar-updated-at')).not.toBeNull();
    const got = Buffer.from(await getRes.arrayBuffer());
    expect(Buffer.compare(got, bytes)).toBe(0);
  });

  it('404s for a player with no stored avatar', async () => {
    const res = await fetch(url('/internal/avatars/p-nobody'), { headers: internal });
    expect(res.status).toBe(404);
  });

  it('rejects an empty body', async () => {
    const res = await put('/internal/avatars/p-empty', Buffer.alloc(0));
    expect(res.status).toBe(400);
  });

  it('rejects a body over the internal size backstop (400, not a crash)', async () => {
    const tooBig = Buffer.alloc(600_000, 1); // over both the 512kb route limit and the 200KB store backstop
    const res = await put('/internal/avatars/p-huge', tooBig);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('a re-upload for the same player overwrites, not accumulates', async () => {
    await put('/internal/avatars/p-reup', Buffer.from('first'));
    await put('/internal/avatars/p-reup', Buffer.from('second-longer-value'));

    const res = await fetch(url('/internal/avatars/p-reup'), { headers: internal });
    const got = Buffer.from(await res.arrayBuffer());
    expect(got.toString()).toBe('second-longer-value');
  });

  it('storing an avatar makes it visible on /me/settings as avatarId "uploaded"', async () => {
    const { signToken } = await import('../../src/http/jwt');
    await put('/internal/avatars/p-settings-link', Buffer.from('img'));

    const token = signToken({ playerId: 'p-settings-link', role: 'player' }, 'test-jwt-secret');
    const res = await fetch(url('/me/settings'), { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { avatarId: string | null };
    expect(body.avatarId).toBe('uploaded');
  });
});
