import express from 'express';
import request from 'supertest';
import { requireAuth, requireAdmin } from '../../src/gateway/auth';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';
import { SuspensionGate } from '../../src/auth/suspension-gate';

/**
 * A demoted administrator has to lose admin access on the SESSION they
 * already hold, not only on their next sign-in.
 *
 * `requireAdmin` used to trust the `ops` claim baked into the token with
 * nothing re-checking it against the database, so `PATCH /admin/players/:id`
 * (role: 'player') wrote the demotion and did nothing to a live session — it
 * kept full admin access (withdrawal queue, every player record, minting more
 * admins) until the token expired, up to `jwtTtlSeconds` (a day by default).
 *
 * A bare Express app with just `requireAuth` + `requireAdmin`, not the full
 * gateway — mirrors `suspension-revokes-session.test.ts` for the identical
 * reason: mounting the whole admin router would drag in financial-core and
 * the audit store to assert a 404.
 *
 * Both middlewares share ONE gate, exactly as `admin-routes.ts` wires them in
 * production (`defaultSuspensionGate` used by both unless overridden) — so
 * these tests also exercise the one-lookup-answers-both-checks sharing.
 */
const JWT_SECRET = 'test-secret-demote';
const config = loadConfig({
  JWT_SECRET,
  NODE_ENV: 'test',
  FINANCIAL_CORE_URL: 'http://127.0.0.1:9',
} as NodeJS.ProcessEnv);

const tokenFor = (role: 'player' | 'ops', playerId = 'p-admin'): string =>
  signToken({ playerId, role }, JWT_SECRET, 3600);

function appWithGate(gate: SuspensionGate) {
  const app = express();
  app.get('/admin/thing', requireAuth(config, gate), requireAdmin(gate), (req, res) => {
    res.json({ ok: true, playerId: req.player!.playerId });
  });
  return app;
}

describe('a demoted administrator loses admin access on the session they already hold', () => {
  it('gets 404 — the same a non-ops caller always gets — once the stored role is no longer ops', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: null, role: 'player' }) });

    const res = await request(appWithGate(gate))
      .get('/admin/thing')
      .set('authorization', `Bearer ${tokenFor('ops')}`);

    // 404, never 403 — a 403 would tell a demoted admin's still-valid-looking
    // token that it USED to work, exactly the map a leaked token should not
    // get. See requireAdmin's comment.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });

  it('lets an account that is still ops through', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: null, role: 'ops' }) });

    const res = await request(appWithGate(gate))
      .get('/admin/thing')
      .set('authorization', `Bearer ${tokenFor('ops')}`);

    expect(res.status).toBe(200);
    expect(res.body.playerId).toBe('p-admin');
  });

  it('takes effect on the next request once primed, with no lookup at all', async () => {
    // What the role-patch route does the moment it writes a demotion. Without
    // it an administrator watches the demoted account keep working for a TTL
    // and reasonably concludes the demotion did nothing — the same complaint
    // that motivated priming for suspension.
    const lookup = jest.fn(async () => ({ suspendedAt: null, role: 'ops' as const }));
    const gate = new SuspensionGate({ lookup });
    const app = appWithGate(gate);

    const before = await request(app)
      .get('/admin/thing')
      .set('authorization', `Bearer ${tokenFor('ops')}`);
    expect(before.status).toBe(200);

    gate.primeRole('p-admin', false);

    const after = await request(app)
      .get('/admin/thing')
      .set('authorization', `Bearer ${tokenFor('ops')}`);
    expect(after.status).toBe(404);
  });

  it('lets a re-promotion back in the moment it is primed', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: null, role: 'player' }) });
    const app = appWithGate(gate);

    gate.primeRole('p-admin', false);
    expect(
      (await request(app).get('/admin/thing').set('authorization', `Bearer ${tokenFor('ops')}`)).status,
    ).toBe(404);

    gate.primeRole('p-admin', true);
    expect(
      (await request(app).get('/admin/thing').set('authorization', `Bearer ${tokenFor('ops')}`)).status,
    ).toBe(200);
  });

  it('falls back to the TOKEN claim on a lookup failure — an outage neither grants nor silently revokes admin access', async () => {
    // The opposite direction from suspension's fail-open, and the point of
    // this whole change: being unable to verify "still admin" is not the same
    // as proving "demoted", so a lookup failure behaves exactly as it did
    // before this check existed — trusting the token, nothing more.
    const gate = new SuspensionGate({
      lookup: async () => {
        throw new Error('mongo is down');
      },
    });

    const res = await request(appWithGate(gate))
      .get('/admin/thing')
      .set('authorization', `Bearer ${tokenFor('ops')}`);

    expect(res.status).toBe(200);
  });

  it('still 404s an ordinary player token, without asking the gate about role', async () => {
    const lookup = jest.fn(async () => ({ suspendedAt: null, role: 'player' as const }));
    const gate = new SuspensionGate({ lookup });

    const res = await request(appWithGate(gate))
      .get('/admin/thing')
      .set('authorization', `Bearer ${tokenFor('player')}`);

    expect(res.status).toBe(404);
    // Exactly one lookup — requireAuth's suspension check. A token that never
    // claimed ops must not cost a second database read to be told no again.
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('still rejects a missing or forged token before any of this', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: null, role: 'ops' }) });
    const app = appWithGate(gate);

    expect((await request(app).get('/admin/thing')).status).toBe(401);

    const forged = signToken({ playerId: 'p-admin', role: 'ops' }, 'wrong-secret', 3600);
    expect(
      (await request(app).get('/admin/thing').set('authorization', `Bearer ${forged}`)).status,
    ).toBe(401);
  });
});
