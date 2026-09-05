import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { LoginError, userStore } from '../../src/auth/user-store';

/**
 * A suspension has to hold on EVERY door.
 *
 * This file exists because it did not. `/auth/google` never consulted
 * `isSignInAllowed` at all — it took whatever `userStore.oauth` returned and
 * minted a session from it — so an administrator could suspend an account and
 * the player would be back in one click on "Sign in with Google". A ban enforced
 * on one of two doors is not a ban, and nothing in the suite would have noticed:
 * every existing test signed in through the password path.
 *
 * Both routes are asserted together, in one file, so that adding a third sign-in
 * method has an obvious place to be checked.
 */
jest.mock('../../src/auth/user-store', () => ({
  // The REAL error class. Mocking the whole module would leave `LoginError`
  // undefined, so `new LoginError(...)` throws inside the test itself and the
  // route's `err instanceof LoginError` could never match.
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

const app = () =>
  createGatewayApp(
    loadConfig({
      JWT_SECRET: 'test-secret-suspension',
      NODE_ENV: 'test',
      FINANCIAL_CORE_URL: 'http://127.0.0.1:9',
    } as NodeJS.ProcessEnv),
  );

beforeEach(() => {
  jest.clearAllMocks();
});

describe('a suspended account cannot sign in with a password', () => {
  it('is refused with 403 and a distinct code', async () => {
    // THROWS now — main's closed refusal set (#61). The route catches a
    // LoginError; a resolved verdict would sail past it as a success.
    (userStore.verifyPassword as jest.Mock).mockRejectedValue(
      new LoginError('suspended', 'This account is suspended: chargeback under review', {
        suspendedReason: 'chargeback under review',
      }),
    );

    const res = await request(app())
      .post('/auth/login')
      .send({ email: 'sam@example.com', password: 'correct-horse' });

    expect(res.status).toBe(403);
    // NOT the same code as an unconfirmed email. Sharing one would send a
    // suspended player round a confirmation loop that can never end in a
    // session, and they would call support about the wrong thing entirely.
    expect(res.body.code).toBe('account_suspended');
    expect(res.body.error).toContain('chargeback under review');
    // No session, by the only measure that counts.
    expect(res.body.token).toBeUndefined();
  });

  it('says so without a reason when no reason was recorded', async () => {
    (userStore.verifyPassword as jest.Mock).mockRejectedValue(
      new LoginError('suspended', 'This account is suspended. Contact support.'),
    );

    const res = await request(app())
      .post('/auth/login')
      .send({ email: 'sam@example.com', password: 'correct-horse' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
    expect(res.body.error).toMatch(/suspended/i);
    expect(res.body.token).toBeUndefined();
  });
});

describe('a suspended account cannot sign in with Google either', () => {
  // The allow-list is read from the environment at request time, not from the
  // config object — unset, the route fails closed with a 503 and never reaches
  // the suspension check at all.
  const ORIGINAL_CLIENT_ID = process.env['GOOGLE_CLIENT_ID'];
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    process.env['GOOGLE_CLIENT_ID'] = 'client-1.apps.googleusercontent.com';
  });

  afterEach(() => {
    if (ORIGINAL_CLIENT_ID === undefined) delete process.env['GOOGLE_CLIENT_ID'];
    else process.env['GOOGLE_CLIENT_ID'] = ORIGINAL_CLIENT_ID;
    global.fetch = ORIGINAL_FETCH;
  });

  const googleFetch = () =>
    jest.fn(async (url: string) => {
      if (url.includes('tokeninfo')) {
        return {
          ok: true,
          json: async () => ({ aud: 'client-1.apps.googleusercontent.com' }),
        };
      }
      if (url.includes('userinfo')) {
        return {
          ok: true,
          json: async () => ({ sub: 'g-9', email: 'sam@example.com', name: 'Sam' }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

  it('is refused with the same status and code as the password path', async () => {
    global.fetch = googleFetch() as unknown as typeof fetch;
    (userStore.oauth as jest.Mock).mockResolvedValue({
      ok: false,
      reason: 'suspended',
      suspendedReason: 'chargeback under review',
    });

    const res = await request(app()).post('/auth/google').send({ token: 'an-access-token' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
    // The identical answer on both doors, deliberately: a suspended player must
    // not be able to learn that one route is softer than the other.
    expect(res.body.token).toBeUndefined();
  });

  it('still lets an ordinary Google account through', async () => {
    // The other half of the check. A guard that refuses everyone is as broken as
    // one that refuses no one, and only asserting the refusal would not tell
    // them apart.
    global.fetch = googleFetch() as unknown as typeof fetch;
    (userStore.oauth as jest.Mock).mockResolvedValue({
      ok: true,
      identity: { playerId: 'g-9', email: 'sam@example.com', displayName: 'Sam', photoUrl: null },
    });

    const res = await request(app()).post('/auth/google').send({ token: 'an-access-token' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });
});
