import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';

/**
 * The gateway's first inbound service route.
 *
 * Every other call runs gateway → financial-core. This one runs back, so that
 * financial-core can ask "where do I email this player" without holding a copy
 * of everyone's address. The tests here are about the door: a player token must
 * not open it, and the answer must contain nothing but an address.
 */

const SECRET = 'internal-test-secret';
const JWT_SECRET = 'jwt-test-secret';

const app = () =>
  createGatewayApp(
    loadConfig({
      JWT_SECRET,
      INTERNAL_API_SECRET: SECRET,
      NODE_ENV: 'test',
      FINANCIAL_CORE_URL: 'http://127.0.0.1:9',
    } as NodeJS.ProcessEnv),
  );

describe('internal email lookup', () => {
  it('401s with no secret', async () => {
    const res = await request(app()).get('/internal/players/web-1/email');
    expect(res.status).toBe(401);
  });

  it('401s on a wrong secret', async () => {
    const res = await request(app())
      .get('/internal/players/web-1/email')
      .set('x-internal-secret', 'not-the-secret');
    expect(res.status).toBe(401);
  });

  it('401s on a valid PLAYER token — this is not a player route', async () => {
    // A player holding a legitimate JWT must not be able to look up anyone's
    // email address, including their own. Different door, different key.
    const token = signToken({ playerId: 'web-1', role: 'player' }, JWT_SECRET, 300);
    const res = await request(app())
      .get('/internal/players/web-1/email')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('401s on an OPS token too', async () => {
    // Even an administrator's token is the wrong kind of credential here. The
    // secret proves a service is calling, which a browser never is.
    const token = signToken({ playerId: 'ops-1', role: 'ops' }, JWT_SECRET, 300);
    const res = await request(app())
      .get('/internal/players/web-1/email')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // The success path is not tested here: it needs a live Mongo, and this suite
  // stands up an app without one. What it would assert — that the response
  // carries an address and nothing else — is instead guaranteed by the route
  // constructing `{ email }` explicitly rather than spreading an identity. A
  // test that timed out against a buffering driver would prove nothing while
  // looking like coverage.
});
