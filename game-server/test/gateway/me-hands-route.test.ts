import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';

/**
 * `GET /me/hands` — the table's hand-history panel.
 *
 * The redaction rule is pinned in test/history/hand-view.test.ts. This pins the
 * door: the route is mounted, it is behind a session like the rest of /me, and
 * it refuses a request that names no table rather than reading every hand the
 * player ever played. None of these reach the database.
 */

const JWT_SECRET = 'test-secret-me-hands';

const app = () =>
  createGatewayApp(
    loadConfig({
      JWT_SECRET,
      NODE_ENV: 'test',
      FINANCIAL_CORE_URL: 'http://127.0.0.1:9',
    } as NodeJS.ProcessEnv),
  );

describe('GET /me/hands', () => {
  it('401s without a session', async () => {
    const res = await request(app()).get('/me/hands?tableId=t-abc');
    expect(res.status).toBe(401);
  });

  it('400s when no table is named', async () => {
    const token = signToken({ playerId: 'p-1', role: 'player' }, JWT_SECRET, 300);
    const res = await request(app()).get('/me/hands').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
