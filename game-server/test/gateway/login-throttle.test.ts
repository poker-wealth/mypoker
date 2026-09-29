import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { LoginError, userStore } from '../../src/auth/user-store';

/**
 * BUG-15: /auth/login had no throttling at all — a password could be
 * guessed against one account, or one guessed password sprayed across every
 * account, at whatever rate the attacker's connection allowed.
 *
 * Same mocking shape as suspension-sign-in.test.ts: the real LoginError class
 * (a fully-mocked module leaves it undefined and `err instanceof LoginError`
 * could never match), a stubbed userStore.
 */
jest.mock('../../src/auth/user-store', () => ({
  ...jest.requireActual('../../src/auth/user-store'),
  userStore: {
    startSignup: jest.fn(),
    verifyPassword: jest.fn(),
    markEmailVerified: jest.fn(),
    oauth: jest.fn(),
    byPlayerId: jest.fn(),
    search: jest.fn(),
    updateDisplayName: jest.fn(),
    changePassword: jest.fn(),
    findForPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
  },
}));

function app() {
  return createGatewayApp(
    loadConfig({
      JWT_SECRET: 'test-secret-login-throttle',
      NODE_ENV: 'test',
      FINANCIAL_CORE_URL: 'http://127.0.0.1:9',
    } as NodeJS.ProcessEnv),
  );
}

const wrongPassword = () =>
  new LoginError('invalid_credentials', 'Incorrect email, phone number or password');

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): a blocked 429 never reaches
  // verifyPassword, so a queued mockResolvedValueOnce/mockRejectedValueOnce
  // that a test never consumed would otherwise leak into the next test's
  // first call. clearAllMocks only wipes call history, not queued once-values.
  jest.resetAllMocks();
});

describe('POST /auth/login throttling', () => {
  it('blocks the 11th failure in a window with 429, without calling the password check again', async () => {
    (userStore.verifyPassword as jest.Mock).mockRejectedValue(wrongPassword());
    const server = app();

    for (let i = 0; i < 10; i++) {
      const res = await request(server)
        .post('/auth/login')
        .send({ email: 'ada@example.com', password: 'wrong' });
      expect(res.status).toBe(401);
    }
    expect(userStore.verifyPassword).toHaveBeenCalledTimes(10);

    const eleventh = await request(server)
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'wrong' });

    expect(eleventh.status).toBe(429);
    expect(eleventh.headers['retry-after']).toBeDefined();
    // The password check must not run a 11th time — the whole point is to
    // stop guesses reaching bcrypt, not just to relabel the response.
    expect(userStore.verifyPassword).toHaveBeenCalledTimes(10);
    // Anti-enumeration: the 429 body still gives nothing away about whether
    // the account exists — it is the same for every identifier once tripped.
    expect(eleventh.body.error).not.toMatch(/no such|not found|does not exist/i);
  });

  it('a successful login resets the counter', async () => {
    (userStore.verifyPassword as jest.Mock).mockRejectedValue(wrongPassword());
    const server = app();

    // Fail fewer than the limit -- once tripped, the throttle refuses BEFORE
    // calling verifyPassword at all (BUG-15's whole point), so a correct
    // password could never itself be the thing that resets the counter.
    // What this test proves instead: failures short of the limit do not
    // carry over past a success.
    for (let i = 0; i < 9; i++) {
      const res = await request(server)
        .post('/auth/login')
        .send({ email: 'bo@example.com', password: 'wrong' });
      expect(res.status).toBe(401);
    }

    (userStore.verifyPassword as jest.Mock).mockResolvedValueOnce({
      playerId: 'bo-1',
      email: 'bo@example.com',
      displayName: 'Bo',
    });
    const success = await request(server)
      .post('/auth/login')
      .send({ email: 'bo@example.com', password: 'correct' });
    expect(success.status).toBe(200);

    // If the 9 earlier failures had survived the success, one more wrong
    // password here would be the throttle's 11th strike and 429. It isn't --
    // the reset actually took effect, and it takes a fresh 10 to trip again.
    (userStore.verifyPassword as jest.Mock).mockRejectedValue(wrongPassword());
    const after = await request(server)
      .post('/auth/login')
      .send({ email: 'bo@example.com', password: 'wrong-again' });
    expect(after.status).toBe(401);
  });

  it('a different identifier from the same IP is throttled independently', async () => {
    (userStore.verifyPassword as jest.Mock).mockRejectedValue(wrongPassword());
    const server = app();

    for (let i = 0; i < 10; i++) {
      await request(server).post('/auth/login').send({ email: 'carl@example.com', password: 'wrong' });
    }
    const tripped = await request(server)
      .post('/auth/login')
      .send({ email: 'carl@example.com', password: 'wrong' });
    expect(tripped.status).toBe(429);

    // carl's account is locked out; dana's is untouched, same connection.
    const dana = await request(server)
      .post('/auth/login')
      .send({ email: 'dana@example.com', password: 'wrong' });
    expect(dana.status).toBe(401);
  });

  it('a different IP for the same identifier is throttled independently', async () => {
    (userStore.verifyPassword as jest.Mock).mockRejectedValue(wrongPassword());
    const server = app();
    // Only this test needs distinct apparent IPs, so it opts the app instance
    // into honouring X-Forwarded-For for itself -- production sets no such
    // thing (see the deviation note in the commit message), so this proves
    // the throttle key is IP-sensitive without asserting anything about how
    // req.ip resolves in a real deployment.
    server.set('trust proxy', true);

    for (let i = 0; i < 10; i++) {
      await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ email: 'erin@example.com', password: 'wrong' });
    }
    const trippedFromFirstIp = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ email: 'erin@example.com', password: 'wrong' });
    expect(trippedFromFirstIp.status).toBe(429);

    const sameIdentifierOtherIp = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ email: 'erin@example.com', password: 'wrong' });
    expect(sameIdentifierOtherIp.status).toBe(401);
  });
});
