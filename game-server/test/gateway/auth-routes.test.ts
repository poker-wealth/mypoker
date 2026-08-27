import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { verifyToken, signToken } from '../../src/gateway/tokens';
import { userStore } from '../../src/auth/user-store';
import { otpStore } from '../../src/auth/otp-store';

// userStore is mocked: the Google routes call userStore.oauth() and /me calls
// userStore.byPlayerId(), both of which would otherwise hit a real Mongoose
// connection this suite never sets up.
jest.mock('../../src/auth/user-store', () => ({
  userStore: {
    startSignup: jest.fn(),
    verifyPassword: jest.fn(),
    markEmailVerified: jest.fn(),
    oauth: jest.fn(),
    search: jest.fn(),
    byPlayerId: jest.fn(),
    updateDisplayName: jest.fn(),
    changePassword: jest.fn(),
    findForPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
  },
}));

// The email-confirmation store is mocked too, for the same reason. The flow it
// backs is exercised for real in test/auth/email-confirmation.test.ts, against
// an in-memory implementation rather than these stubs -- see docs/TRAPS.md #1
// on what a suite of mocks does and does not prove.
jest.mock('../../src/auth/otp-store', () => ({
  otpStore: { issue: jest.fn(), verify: jest.fn(), peek: jest.fn(), discard: jest.fn() },
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

  it('returns the real email and hasPassword: true for a password account', async () => {
    (userStore.byPlayerId as jest.Mock).mockResolvedValueOnce({
      playerId: 'player-abc123',
      displayName: 'Real Name',
      photoUrl: null,
      email: 'ada@example.com',
      hasPassword: true,
    });

    const res = await request(appWith())
      .get('/auth/me')
      .set('authorization', `Bearer ${tokenFor('player-abc123')}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('ada@example.com');
    expect(res.body.hasPassword).toBe(true);
  });

  it('returns hasPassword: false for a Google-linked account with no passwordHash', async () => {
    (userStore.byPlayerId as jest.Mock).mockResolvedValueOnce({
      playerId: 'g-100',
      displayName: 'Ada',
      photoUrl: null,
      email: 'ada@example.com',
      hasPassword: false,
    });

    const res = await request(appWith())
      .get('/auth/me')
      .set('authorization', `Bearer ${tokenFor('g-100')}`);

    expect(res.status).toBe(200);
    expect(res.body.hasPassword).toBe(false);
  });

  it('returns email: null and hasPassword: false for a Telegram player, who has no stored document', async () => {
    (userStore.byPlayerId as jest.Mock).mockResolvedValueOnce(null);

    const res = await request(appWith())
      .get('/auth/me')
      .set('authorization', `Bearer ${tokenFor('tg-777')}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBeNull();
    expect(res.body.hasPassword).toBe(false);
  });

  it('never lets the password hash reach the response body, even if the store returned one', async () => {
    // A future refactor that spreads the raw user document into the response
    // is exactly what this guards against -- so the mock here hands back a
    // shape that HAS a passwordHash, the way a careless `...stored` would.
    const secretHash = '$2b$10$this.is.a.fake.bcrypt.hash.value.for.testing';
    (userStore.byPlayerId as jest.Mock).mockResolvedValueOnce({
      playerId: 'player-abc123',
      displayName: 'Real Name',
      photoUrl: null,
      email: 'ada@example.com',
      hasPassword: true,
      passwordHash: secretHash,
    });

    const res = await request(appWith())
      .get('/auth/me')
      .set('authorization', `Bearer ${tokenFor('player-abc123')}`);

    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(secretHash);
    expect(serialized).not.toContain('passwordHash');
    expect(res.body).toEqual({
      playerId: 'player-abc123',
      displayName: 'Real Name',
      username: null,
      photoUrl: null,
      telegramId: null,
      vipTier: 0,
      email: 'ada@example.com',
      hasPassword: true,
    });
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

describe('POST /auth/google', () => {
  const ORIGINAL_CLIENT_ID = process.env['GOOGLE_CLIENT_ID'];
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    if (ORIGINAL_CLIENT_ID === undefined) delete process.env['GOOGLE_CLIENT_ID'];
    else process.env['GOOGLE_CLIENT_ID'] = ORIGINAL_CLIENT_ID;
    global.fetch = ORIGINAL_FETCH;
  });

  it('503s when unconfigured, and never calls out to Google (fail closed)', async () => {
    delete process.env['GOOGLE_CLIENT_ID'];
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await request(appWith()).post('/auth/google').send({ token: 'whatever' });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Google sign-in is not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an access token issued to a client outside the allow-list', async () => {
    process.env['GOOGLE_CLIENT_ID'] = 'good-client.apps.googleusercontent.com';
    // userinfo is deliberately mocked to succeed here too: it reports whose
    // token this is but not which client requested it, so if the aud check
    // were skipped this attacker-controlled token would otherwise sail
    // through to a 200 with a real session issued for the victim's account.
    const fetchSpy = jest.fn(async (url: string) => {
      if (url.includes('tokeninfo')) {
        return {
          ok: true,
          json: async () => ({ aud: 'some-other-app.apps.googleusercontent.com' }),
        };
      }
      if (url.includes('userinfo')) {
        return {
          ok: true,
          json: async () => ({ sub: 'victim-1', email: 'victim@example.com', name: 'Victim' }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    (userStore.oauth as jest.Mock).mockResolvedValue({
      playerId: 'victim-1',
      email: 'victim@example.com',
      displayName: 'Victim',
      photoUrl: null,
    });

    const res = await request(appWith()).post('/auth/google').send({ token: 'some-access-token' });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('accepts an access token issued to an allow-listed client', async () => {
    process.env['GOOGLE_CLIENT_ID'] = 'good-client.apps.googleusercontent.com';
    const fetchSpy = jest.fn(async (url: string) => {
      if (url.includes('tokeninfo')) {
        return {
          ok: true,
          json: async () => ({ aud: 'good-client.apps.googleusercontent.com' }),
        };
      }
      if (url.includes('userinfo')) {
        return {
          ok: true,
          json: async () => ({ sub: 'g-100', email: 'ada@example.com', name: 'Ada' }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    (userStore.oauth as jest.Mock).mockResolvedValue({
      playerId: 'g-100',
      email: 'ada@example.com',
      displayName: 'Ada',
      photoUrl: null,
    });

    const res = await request(appWith()).post('/auth/google').send({ token: 'some-access-token' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.player.displayName).toBe('Ada');
  });

  it('rejects a JWT-shaped token that fails audience verification, without retrying it as an access token', async () => {
    process.env['GOOGLE_CLIENT_ID'] = 'good-client.apps.googleusercontent.com';
    const fetchSpy = jest.fn(async (url: string) => {
      throw new Error(`unexpected fetch: ${url}`);
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    // Three dot-separated segments so the handler treats it as a JWT; it is
    // not a real Google-signed token, so verifyIdToken will reject it.
    const fakeJwt = 'header.payload.signature';
    const res = await request(appWith()).post('/auth/google').send({ credential: fakeJwt });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('tokeninfo'));
  });
});

describe('POST /auth/change-display-name', () => {
  afterEach(() => jest.clearAllMocks());

  function tokenFor(playerId: string): string {
    return signToken({ playerId, role: 'player' }, JWT_SECRET, 3600);
  }

  it('changes the display name and the new value persists', async () => {
    (userStore.updateDisplayName as jest.Mock).mockResolvedValueOnce({
      playerId: 'player-1',
      email: 'ada@example.com',
      displayName: 'New Name',
      photoUrl: null,
    });

    const res = await request(appWith())
      .post('/auth/change-display-name')
      .set('authorization', `Bearer ${tokenFor('player-1')}`)
      .send({ displayName: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.player.displayName).toBe('New Name');
    expect(userStore.updateDisplayName).toHaveBeenCalledWith('player-1', 'New Name');

    // "Persists": a subsequent read reflects the same value the store now holds.
    (userStore.byPlayerId as jest.Mock).mockResolvedValueOnce({
      playerId: 'player-1',
      displayName: 'New Name',
      photoUrl: null,
    });
    const me = await request(appWith())
      .get('/auth/me')
      .set('authorization', `Bearer ${tokenFor('player-1')}`);
    expect(me.body.displayName).toBe('New Name');
  });

  it('401s an unauthenticated caller', async () => {
    const res = await request(appWith())
      .post('/auth/change-display-name')
      .send({ displayName: 'X' });
    expect(res.status).toBe(401);
    expect(userStore.updateDisplayName).not.toHaveBeenCalled();
  });
});

describe('POST /auth/change-password', () => {
  afterEach(() => jest.clearAllMocks());

  function tokenFor(playerId: string): string {
    return signToken({ playerId, role: 'player' }, JWT_SECRET, 3600);
  }

  it('succeeds with the correct current password, and the new password then works at /auth/login', async () => {
    // Mirrors what the real userStore.changePassword does -- it only
    // succeeds when the supplied current password is the right one.
    (userStore.changePassword as jest.Mock).mockImplementation(
      async (_playerId: string, current: string, _next: string) =>
        current === 'OldPass123'
          ? { ok: true }
          : { ok: false, reason: 'invalid_current_password' },
    );

    const res = await request(appWith())
      .post('/auth/change-password')
      .set('authorization', `Bearer ${tokenFor('player-1')}`)
      .send({ currentPassword: 'OldPass123', newPassword: 'NewPass456' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(userStore.changePassword).toHaveBeenCalledWith('player-1', 'OldPass123', 'NewPass456');

    (userStore.verifyPassword as jest.Mock).mockImplementation(
      async (_id: string, password: string) =>
        password === 'NewPass456'
          ? { ok: true, identity: { playerId: 'player-1', email: 'ada@example.com', displayName: 'Ada' } }
          : { ok: false, reason: 'invalid_credentials' },
    );

    const login = await request(appWith())
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'NewPass456' });
    expect(login.status).toBe(200);
  });

  it('refuses a wrong current password, and the old password still works afterwards', async () => {
    (userStore.changePassword as jest.Mock).mockResolvedValueOnce({
      ok: false,
      reason: 'invalid_current_password',
    });

    const res = await request(appWith())
      .post('/auth/change-password')
      .set('authorization', `Bearer ${tokenFor('player-1')}`)
      .send({ currentPassword: 'WrongPass', newPassword: 'NewPass456' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_current_password');

    // The old password still works -- nothing about this attempt changed it.
    (userStore.verifyPassword as jest.Mock).mockResolvedValueOnce({
      ok: true,
      identity: { playerId: 'player-1', email: 'ada@example.com', displayName: 'Ada' },
    });
    const login = await request(appWith())
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'OldPass123' });
    expect(login.status).toBe(200);
  });

  it('refuses clearly on a Google-linked account with no password to change', async () => {
    (userStore.changePassword as jest.Mock).mockResolvedValueOnce({ ok: false, reason: 'no_password' });

    const res = await request(appWith())
      .post('/auth/change-password')
      .set('authorization', `Bearer ${tokenFor('player-1')}`)
      .send({ currentPassword: 'whatever', newPassword: 'NewPass456' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_password');
  });

  it('401s an unauthenticated caller', async () => {
    const res = await request(appWith())
      .post('/auth/change-password')
      .send({ currentPassword: 'a', newPassword: 'NewPass456' });
    expect(res.status).toBe(401);
    expect(userStore.changePassword).not.toHaveBeenCalled();
  });
});

// Forgot-password is deliberately UNauthenticated (see the class comment in
// gateway/auth.ts) -- recovering an account nobody can currently sign into
// cannot require a bearer token for that account. There is no "401s an
// unauthenticated caller" case here for that reason.
describe('POST /auth/forgot-password + /auth/reset-password', () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    // Never let this suite make a real network call to financial-core. The
    // route's HTTP response does not depend on whether the mail actually
    // sends (see the class comment on /forgot-password) -- these tests only
    // assert on what was decided BEFORE that call: whether a code was minted
    // at all.
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.clearAllMocks();
  });

  it('responds identically to a known and an unknown address (no enumeration)', async () => {
    (userStore.findForPasswordReset as jest.Mock).mockImplementation(async (email: string) =>
      email === 'known@example.com' ? { playerId: 'player-1', hasPassword: true } : null,
    );
    (otpStore.issue as jest.Mock).mockResolvedValue({
      ok: true,
      issued: {
        code: '123456',
        expiresAt: Date.now() + 600_000,
        resendAvailableAt: Date.now() + 60_000,
        sends: 1,
      },
    });

    const app = appWith();
    const known = await request(app).post('/auth/forgot-password').send({ email: 'known@example.com' });
    const unknown = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'unknown@example.com' });

    expect(known.status).toBe(unknown.status);
    expect(Object.keys(known.body).sort()).toEqual(Object.keys(unknown.body).sort());
    expect(known.body.pending).toBe(true);
    expect(unknown.body.pending).toBe(true);

    // A code was minted only for the account that actually exists (and has a
    // password) -- that is what must differ. The RESPONSE must not, which is
    // what the assertions above check.
    expect(otpStore.issue).toHaveBeenCalledTimes(1);
    expect(otpStore.issue).toHaveBeenCalledWith('known@example.com', 'player-1', expect.any(Number));
  });

  it('does not mint or mail a code for a Google-linked account with no password', async () => {
    (userStore.findForPasswordReset as jest.Mock).mockResolvedValueOnce({
      playerId: 'player-2',
      hasPassword: false,
    });

    const res = await request(appWith())
      .post('/auth/forgot-password')
      .send({ email: 'google-only@example.com' });

    expect(res.status).toBe(200);
    expect(otpStore.issue).not.toHaveBeenCalled();
  });

  it('refuses a wrong code at /auth/reset-password', async () => {
    (otpStore.verify as jest.Mock).mockResolvedValueOnce({ ok: false, reason: 'incorrect' });

    const res = await request(appWith())
      .post('/auth/reset-password')
      .send({ email: 'ada@example.com', code: '000000', newPassword: 'NewPass456' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('incorrect');
    expect(userStore.resetPassword).not.toHaveBeenCalled();
  });

  it('sets the password with the right code, and the new password then works at /auth/login', async () => {
    (otpStore.verify as jest.Mock).mockResolvedValueOnce({ ok: true, playerId: 'player-9' });
    (userStore.resetPassword as jest.Mock).mockResolvedValueOnce({
      playerId: 'player-9',
      email: 'ada@example.com',
      displayName: 'Ada',
    });

    const res = await request(appWith())
      .post('/auth/reset-password')
      .send({ email: 'ada@example.com', code: '123456', newPassword: 'NewPass456' });

    expect(res.status).toBe(200);
    expect(userStore.resetPassword).toHaveBeenCalledWith('player-9', 'NewPass456');

    (userStore.verifyPassword as jest.Mock).mockResolvedValueOnce({
      ok: true,
      identity: { playerId: 'player-9', email: 'ada@example.com', displayName: 'Ada' },
    });
    const login = await request(appWith())
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'NewPass456' });
    expect(login.status).toBe(200);
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
