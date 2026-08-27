import express, { type Express } from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { buildMeRouter, type MeRouterDeps } from '../../src/gateway/me-routes';
import { buildAvatarRouter } from '../../src/gateway/avatar-routes';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';
import { createAvatarUploadLimiter, type UploadHistoryPersistence } from '../../src/auth/avatar-upload-store';
import type { UploadHistory } from '../../src/auth/avatar-upload-rules';

/**
 * `POST /me/avatar` and `GET /avatars/:playerId`, over real HTTP.
 *
 * Mirrors the DI pattern in email-confirmation.test.ts: `buildMeRouter` is
 * mounted directly with an in-memory rate-limit persistence port injected,
 * rather than through `createGatewayApp`, because the production limiter is
 * Mongo-backed and this package's tests never stand up a real database (see
 * docs/TRAPS.md §11 on why `npm test` is what CI runs). financial-core itself
 * is stood in for with a mocked `global.fetch` — there is no real
 * financial-core process in this suite either.
 *
 * The one exception is the oversized-body case, which goes through the REAL
 * `createGatewayApp` — the size limit AND the error-handling that turns a
 * body-parser rejection into a clean 413 both live in gateway/app.ts, and
 * only exercising the real app proves the wiring, not just the route.
 */

const JWT_SECRET = 'test-jwt-secret';
const FINANCIAL_CORE_URL = 'http://financial-core.test';
const INTERNAL_SECRET = 'test-internal-secret';
const PLAYER = 'p-avatar-test';

function tokenFor(playerId: string): string {
  return signToken({ playerId, role: 'player' }, JWT_SECRET, 3600);
}

function memoryPersistence(): UploadHistoryPersistence {
  const rows = new Map<string, UploadHistory>();
  return {
    async get(playerId) {
      const row = rows.get(playerId);
      return row ? { ...row } : null;
    },
    async put(playerId, value) {
      rows.set(playerId, { ...value });
    },
  };
}

function testConfig() {
  return loadConfig({
    JWT_SECRET,
    FINANCIAL_CORE_URL,
    INTERNAL_API_SECRET: INTERNAL_SECRET,
    CORS_ORIGINS: 'http://localhost:5173',
  } as NodeJS.ProcessEnv);
}

/** A fresh app with an injected, in-memory rate limiter — the harness most tests use. */
function appWithDeps(deps: MeRouterDeps = {}): Express {
  const config = testConfig();
  const app = express();
  app.use('/me', buildMeRouter(config, deps));
  app.use('/avatars', buildAvatarRouter(config));
  return app;
}

async function makeJpeg(width = 40, height = 40): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 20, b: 20 } } })
    .jpeg()
    .toBuffer();
}

let fetchSpy: jest.SpyInstance;

beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
});

/** Stubs financial-core: the PUT that stores bytes, and the GET /me/settings read-back. */
function mockFinancialCoreSuccess(): void {
  fetchSpy.mockImplementation((url: string | URL, init?: RequestInit) => {
    const href = url.toString();
    if (href.includes('/internal/avatars/') && init?.method === 'PUT') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (href.endsWith('/me/settings')) {
      return Promise.resolve(
        new Response(JSON.stringify({ avatarId: 'uploaded', sound: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    throw new Error(`unexpected fetch: ${href}`);
  });
}

describe('POST /me/avatar', () => {
  it('rejects an unauthenticated upload', async () => {
    const app = appWithDeps({ avatarUploadLimiter: createAvatarUploadLimiter(memoryPersistence()) });
    const res = await request(app)
      .post('/me/avatar')
      .set('content-type', 'image/jpeg')
      .send(await makeJpeg());

    expect(res.status).toBe(401);
  });

  it('accepts a valid JPEG, stores it via financial-core, and returns the settled settings', async () => {
    mockFinancialCoreSuccess();
    const app = appWithDeps({ avatarUploadLimiter: createAvatarUploadLimiter(memoryPersistence()) });

    const res = await request(app)
      .post('/me/avatar')
      .set('authorization', `Bearer ${tokenFor(PLAYER)}`)
      .set('content-type', 'image/jpeg')
      .send(await makeJpeg());

    expect(res.status).toBe(200);
    expect(res.body.avatarId).toBe('uploaded');
    expect(res.body.avatarUrl).toBe(`/avatars/${PLAYER}`);

    // The bytes actually forwarded to financial-core are the RE-ENCODED
    // output, never the raw upload — confirms the dangerous work happens
    // before anything leaves the gateway.
    const putCall = fetchSpy.mock.calls.find(
      ([url, init]) => url.toString().includes('/internal/avatars/') && (init as RequestInit)?.method === 'PUT',
    );
    expect(putCall).toBeDefined();
    const forwarded = (putCall![1] as RequestInit).body as Buffer;
    const meta = await sharp(forwarded).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(256);
  });

  it('accepts a valid PNG', async () => {
    mockFinancialCoreSuccess();
    const app = appWithDeps({ avatarUploadLimiter: createAvatarUploadLimiter(memoryPersistence()) });
    const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } })
      .png()
      .toBuffer();

    const res = await request(app)
      .post('/me/avatar')
      .set('authorization', `Bearer ${tokenFor(PLAYER)}`)
      .set('content-type', 'image/png')
      .send(png);

    expect(res.status).toBe(200);
  });

  it('accepts a valid WebP', async () => {
    mockFinancialCoreSuccess();
    const app = appWithDeps({ avatarUploadLimiter: createAvatarUploadLimiter(memoryPersistence()) });
    const webp = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .webp()
      .toBuffer();

    const res = await request(app)
      .post('/me/avatar')
      .set('authorization', `Bearer ${tokenFor(PLAYER)}`)
      .set('content-type', 'image/webp')
      .send(webp);

    expect(res.status).toBe(200);
  });

  it('rejects a file whose bytes are not an image, EVEN THOUGH Content-Type says image/png', async () => {
    const app = appWithDeps({ avatarUploadLimiter: createAvatarUploadLimiter(memoryPersistence()) });

    // A genuine, sharp-decodable TIFF — not garbage — disguised with a PNG
    // Content-Type. Only the magic-byte allow-list catches this; sharp alone
    // would happily decode it.
    const tiff = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .tiff()
      .toBuffer();

    const res = await request(app)
      .post('/me/avatar')
      .set('authorization', `Bearer ${tokenFor(PLAYER)}`)
      .set('content-type', 'image/png')
      .send(tiff);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bad_format');
    // No call to financial-core should ever have been made for a rejected file.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an image with absurd declared dimensions', async () => {
    const app = appWithDeps({ avatarUploadLimiter: createAvatarUploadLimiter(memoryPersistence()) });
    const huge = await sharp({ create: { width: 6500, height: 6500, channels: 3, background: { r: 1, g: 1, b: 1 } } })
      .png()
      .toBuffer();

    const res = await request(app)
      .post('/me/avatar')
      .set('authorization', `Bearer ${tokenFor(PLAYER)}`)
      .set('content-type', 'image/png')
      .send(huge);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('too_large_dimensions');
  }, 20_000);

  it('rate-limits repeated uploads from the same player', async () => {
    mockFinancialCoreSuccess();
    const limiter = createAvatarUploadLimiter(memoryPersistence());
    const app = appWithDeps({ avatarUploadLimiter: limiter });
    const jpeg = await makeJpeg();

    const first = await request(app)
      .post('/me/avatar')
      .set('authorization', `Bearer ${tokenFor(PLAYER)}`)
      .set('content-type', 'image/jpeg')
      .send(jpeg);
    expect(first.status).toBe(200);

    // Immediately again — inside the cooldown.
    const second = await request(app)
      .post('/me/avatar')
      .set('authorization', `Bearer ${tokenFor(PLAYER)}`)
      .set('content-type', 'image/jpeg')
      .send(jpeg);

    expect(second.status).toBe(429);
    expect(second.body.code).toBe('cooldown');
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('rejects a request body over the size cap with 413, via the real gateway app', async () => {
    // Full createGatewayApp, not the DI harness: the limit AND the
    // error-handling that turns body-parser's rejection into a clean 413
    // both live in gateway/app.ts. This never reaches the route handler, so
    // the real (Mongo-backed) rate limiter is never touched.
    //
    // No INTERNAL_API_SECRET here, deliberately: setting it would make
    // createGatewayApp also mount the live-table socket server, which needs
    // more than this test wants to stand up. /me/avatar itself is mounted
    // unconditionally, so leaving it unset does not affect what is under
    // test.
    const app = createGatewayApp(loadConfig({ JWT_SECRET, CORS_ORIGINS: 'http://localhost:5173' } as NodeJS.ProcessEnv));
    const oversized = Buffer.alloc(3 * 1024 * 1024, 0x1); // 3MB > the 2MB avatar cap

    const res = await request(app)
      .post('/me/avatar')
      .set('authorization', `Bearer ${tokenFor(PLAYER)}`)
      .set('content-type', 'application/octet-stream')
      .send(oversized);

    expect(res.status).toBe(413);
  });
});

describe('GET /avatars/:playerId', () => {
  it('serves stored bytes with the fixed public headers', async () => {
    const bytes = Buffer.from('pretend-jpeg-bytes');
    fetchSpy.mockResolvedValueOnce(
      new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
    );
    const app = appWithDeps();

    const res = await request(app).get(`/avatars/${PLAYER}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('max-age');
    expect(Buffer.compare(res.body as Buffer, bytes)).toBe(0);
  });

  it('404s for a player with no uploaded avatar', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const app = appWithDeps();

    const res = await request(app).get('/avatars/nobody-here');
    expect(res.status).toBe(404);
  });

  it('requires no authentication — an avatar is shown to other players', async () => {
    const bytes = Buffer.from('x');
    fetchSpy.mockResolvedValueOnce(new Response(bytes, { status: 200 }));
    const app = appWithDeps();

    const res = await request(app).get(`/avatars/${PLAYER}`); // no authorization header
    expect(res.status).toBe(200);
  });
});
