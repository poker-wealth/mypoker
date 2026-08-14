import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';

/**
 * The admin API's guard.
 *
 * The `ops` role sat in the token type from the beginning with nothing reading
 * it, so these are the first tests that the admin surface is closed at all.
 * They matter more than the screens behind it: an admin panel whose guard is a
 * placeholder is how unguarded admin reaches production.
 */

const JWT_SECRET = 'test-secret-admin';

const app = () =>
  createGatewayApp(
    loadConfig({
      JWT_SECRET,
      NODE_ENV: 'test',
      // No INTERNAL_API_SECRET: live tables stay unmounted, and every upstream
      // call fails closed. These tests are about the door, not the room.
      FINANCIAL_CORE_URL: 'http://127.0.0.1:9', // discard port — never answers
    } as NodeJS.ProcessEnv),
  );

const tokenFor = (role: 'player' | 'league_admin' | 'ops'): string =>
  signToken({ playerId: `u-${role}`, role }, JWT_SECRET, 300);

describe('admin API guard', () => {
  it('401s with no token at all', async () => {
    const res = await request(app()).get('/admin/overview');
    expect(res.status).toBe(401);
  });

  it('401s on a forged token', async () => {
    const forged = signToken({ playerId: 'u-1', role: 'ops' }, 'the-wrong-secret', 300);
    const res = await request(app()).get('/admin/overview').set('authorization', `Bearer ${forged}`);
    // Signed with the wrong key, so it never reaches the role check.
    expect(res.status).toBe(401);
  });

  it('404s — not 403 — for an ordinary player', async () => {
    // 403 would confirm the admin API exists and that this account merely lacks
    // the rank, which is a map for anyone holding a stolen player token.
    const res = await request(app())
      .get('/admin/overview')
      .set('authorization', `Bearer ${tokenFor('player')}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });

  it('404s for a league admin', async () => {
    // A league administrator runs their own alliance. The platform's withdrawal
    // queue and treasury are a different scope — the 12-week plan (W10) gives
    // league admins their own separate panel, scoped to their league's players
    // only — and "admin" in one does not mean "admin" in the other. (Not §13.6:
    // that section is Agent Permission Boundaries, about agents.)
    const res = await request(app())
      .get('/admin/overview')
      .set('authorization', `Bearer ${tokenFor('league_admin')}`);

    expect(res.status).toBe(404);
  });

  it('lets ops through to the route itself', async () => {
    const res = await request(app())
      .get('/admin/overview')
      .set('authorization', `Bearer ${tokenFor('ops')}`);

    // 502: past the guard, and failing at the unreachable upstream — which is
    // the proof it got through. Anything in the 4xx range would mean the door
    // rejected it.
    expect(res.status).toBe(502);
  });

  it('does not leak the admin surface to an unauthenticated probe', async () => {
    // A 404 here and a 404 for a signed-in player are indistinguishable from
    // outside, except that this one is a 401 — a statement about the request,
    // not about what lies behind it.
    const res = await request(app()).get('/admin/overview');
    expect(res.body).not.toHaveProperty('role');
    expect(JSON.stringify(res.body)).not.toMatch(/ops|admin/i);
  });
});
