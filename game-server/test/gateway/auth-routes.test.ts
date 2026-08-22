import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { verifyToken, signToken } from '../../src/gateway/tokens';
import { userStore } from '../../src/auth/user-store';

jest.mock('../../src/auth/user-store', () => ({
  userStore: {
    signup: jest.fn(),
    verifyPassword: jest.fn(),
    oauth: jest.fn(),
    search: jest.fn(),
    byPlayerId: jest.fn(),
  },
}));

const BOT_TOKEN = '123456:TEST-BOT-TOKEN-not-a-real-one';
const JWT_SECRET = 'test-jwt-secret';

function signInitData(fields: Record<string, string>): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function freshInitData(): string {
  return signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 4242, first_name: 'Ada', username: 'ada', photo_url: 'https://x/a.jpg' }),
  });
}

function appWith(env: Record<string, string | undefined> = {}) {
  return createGatewayApp(
    loadConfig({
      TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      JWT_SECRET,
      CORS_ORIGINS: 'http://localhost:5173',
      ...env,
    } as NodeJS.ProcessEnv),
  );
}

describe('POST /auth/telegram', () => {
  it('signs in a genuine Mini App launch and returns a token + profile', async () => {
    const res = await request(appWith()).post('/auth/telegram').send({ initData: freshInitData() });

    expect(res.status).toBe(200);
    expect(res.body.player).toEqual({
      playerId: 'tg-4242',
      displayName: 'Ada',
      username: 'ada',
      photoUrl: 'https://x/a.jpg',
      telegramId: 4242,
      vipTier: 0,
    });
    expect(typeof res.body.token).toBe('string');
  });

  it('issues a token the Financial Core will accept', async () => {
    // financial-core verifies with the identical algorithm and claim shape, so if
    // this decodes cleanly here it decodes there — the two must not drift.
    const res = await request(appWith()).post('/auth/telegram').send({ initData: freshInitData() });
    const claims = verifyToken(res.body.token as string, JWT_SECRET);

    expect(claims.playerId).toBe('tg-4242');
    expect(claims.role).toBe('player');
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('signs the same Telegram user back to the same player id every time', async () => {
    const app = appWith();
    const first = await request(app).post('/auth/telegram').send({ initData: freshInitData() });
    const second = await request(app).post('/auth/telegram').send({ initData: freshInitData() });

    expect(first.body.player.playerId).toBe(second.body.player.playerId);
  });

  it('rejects a tampered payload with 401', async () => {
    const tampered = freshInitData().replace(/hash=[0-9a-f]+/, `hash=${'0'.repeat(64)}`);
    const res = await request(appWith()).post('/auth/telegram').send({ initData: tampered });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('signature does not match');
  });

  it('rejects a missing initData with 400', async () => {
    const res = await request(appWith()).post('/auth/telegram').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  function tokenFor(playerId: string): string {
    return signToken({ playerId, role: 'player' }, JWT_SECRET, 3600);
  }

  it('returns the player for a valid token', async () => {
    const app = appWith();
    const login = await request(app).post('/auth/telegram').send({ initData: freshInitData() });
    const res = await request(app)
      .get('/auth/me')
      .set('authorization', `Bearer ${login.body.token as string}`);

    expect(res.status).toBe(200);
    expect(res.body.playerId).toBe('tg-4242');
    expect(res.body.telegramId).toBe(4242);
  });

  it('returns the stored display name and photo for a web-signed-up player', async () => {
    (userStore.byPlayerId as jest.Mock).mockResolvedValueOnce({
      playerId: 'player-abc123',
      displayName: 'Real Name',
      photoUrl: 'https://example.com/real.jpg',
    });

    const res = await request(appWith())
      .get('/auth/me')
      .set('authorization', `Bearer ${tokenFor('player-abc123')}`);

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Real Name');
    expect(res.body.photoUrl).toBe('https://example.com/real.jpg');
    expect(res.body.displayName).not.toBe('player-abc123');
  });

  it('falls back to the derived shape for a Telegram player, who has no stored document', async () => {
    (userStore.byPlayerId as jest.Mock).mockResolvedValueOnce(null);

    const res = await request(appWith())
      .get('/auth/me')
      .set('authorization', `Bearer ${tokenFor('tg-12345')}`);

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('tg-12345');
    expect(res.body.telegramId).toBe(12345);
  });

  it('falls back to the playerId when the stored identity has no displayName', async () => {
    (userStore.byPlayerId as jest.Mock).mockResolvedValueOnce({
      playerId: 'player-noname',
      photoUrl: null,
    });

    const res = await request(appWith())
      .get('/auth/me')
      .set('authorization', `Bearer ${tokenFor('player-noname')}`);

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('player-noname');
  });

  it('401s with no token', async () => {
    const res = await request(appWith()).get('/auth/me');
    expect(res.status).toBe(401);
    expect(userStore.byPlayerId).not.toHaveBeenCalled();
  });

  it('401s with a token signed by someone else', async () => {
    // The forgery that matters: a well-formed JWT minted with the wrong secret.
    const app = appWith();
    const login = await request(app).post('/auth/telegram').send({ initData: freshInitData() });
    const [header, payload] = (login.body.token as string).split('.');
    const forgedSig = createHmac('sha256', 'wrong-secret')
      .update(`${header}.${payload}`)
      .digest('base64url');

    const res = await request(app)
      .get('/auth/me')
      .set('authorization', `Bearer ${header}.${payload}.${forgedSig}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('bad signature');
  });
});

describe('POST /auth/dev', () => {
  it('is invisible unless explicitly enabled', async () => {
    const res = await request(appWith()).post('/auth/dev').send({});
    expect(res.status).toBe(404);
  });

  it('signs in a dev player when enabled outside production', async () => {
    const app = appWith({ DEV_AUTH_BYPASS: 'true', NODE_ENV: 'development' });
    const res = await request(app).post('/auth/dev').send({});

    expect(res.status).toBe(200);
    expect(res.body.player.playerId).toBe('tg-dev-1');
  });
});

describe('configuration guards', () => {
  it('refuses to start without a JWT secret', () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: BOT_TOKEN } as NodeJS.ProcessEnv)).toThrow(
      /JWT_SECRET is required/,
    );
  });

  it('refuses to start with the dev bypass on in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        TELEGRAM_BOT_TOKEN: BOT_TOKEN,
        JWT_SECRET,
        DEV_AUTH_BYPASS: 'true',
      } as NodeJS.ProcessEnv),
    ).toThrow(/DEV_AUTH_BYPASS cannot be enabled in production/);
  });

  it('refuses to start in production without a bot token', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', JWT_SECRET } as NodeJS.ProcessEnv),
    ).toThrow(/TELEGRAM_BOT_TOKEN is required/);
  });
});

describe('CORS', () => {
  it('echoes an allow-listed origin', async () => {
    const res = await request(appWith())
      .post('/auth/telegram')
      .set('origin', 'http://localhost:5173')
      .send({ initData: freshInitData() });

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('never allows an unknown origin', async () => {
    const res = await request(appWith())
      .post('/auth/telegram')
      .set('origin', 'https://evil.example')
      .send({ initData: freshInitData() });

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
