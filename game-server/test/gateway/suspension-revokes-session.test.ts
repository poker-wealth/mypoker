import express from 'express';
import request from 'supertest';
import { requireAuth } from '../../src/gateway/auth';
import { loadConfig } from '../../src/gateway/config';
import { signToken } from '../../src/gateway/tokens';
import { SuspensionGate } from '../../src/auth/suspension-gate';

/**
 * Suspension has to revoke a session that ALREADY EXISTS.
 *
 * It did not. Suspension blocked signing in and nothing else, so a player
 * holding a token kept it — games included — until it expired, up to
 * twenty-four hours. For the case suspensions are issued for, that is exactly
 * the window that matters: the cheat stays at the table.
 *
 * Found by a human asking "am I even supposed to still be able to use the app?"
 * — a question no test was asking, because every test signed in fresh.
 *
 * A bare Express app rather than the full gateway: this is about the middleware
 * and nothing else, and mounting the whole app would drag in a database, a
 * financial-core stub and the live-table rail to assert one 401.
 */
const JWT_SECRET = 'test-secret-revoke';
const config = loadConfig({
  JWT_SECRET,
  NODE_ENV: 'test',
  FINANCIAL_CORE_URL: 'http://127.0.0.1:9',
} as NodeJS.ProcessEnv);

const tokenFor = (playerId: string): string =>
  signToken({ playerId, role: 'player' }, JWT_SECRET, 3600);

function appWithGate(gate: SuspensionGate) {
  const app = express();
  app.get('/protected', requireAuth(config, gate), (req, res) => {
    res.json({ ok: true, playerId: req.player!.playerId });
  });
  return app;
}

describe('a suspended account cannot use a token it already holds', () => {
  it('refuses the request with 401 and a distinct code', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: new Date() }) });

    const res = await request(appWithGate(gate))
      .get('/protected')
      .set('authorization', `Bearer ${tokenFor('p-banned')}`);

    // 401, not 403: the client's 401 handler already drops the session and
    // returns the player to sign-in, which is the outcome we want. The `code`
    // is what lets the screen say why instead of a bare "Signed out".
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('account_suspended');
  });

  it('still lets an active account through', async () => {
    // The other half. A gate that refuses everyone passes the test above and
    // takes the platform down.
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: null }) });

    const res = await request(appWithGate(gate))
      .get('/protected')
      .set('authorization', `Bearer ${tokenFor('p-fine')}`);

    expect(res.status).toBe(200);
    expect(res.body.playerId).toBe('p-fine');
  });

  it('lets a Telegram player through, who has no identity document at all', async () => {
    const gate = new SuspensionGate({ lookup: async () => null });

    const res = await request(appWithGate(gate))
      .get('/protected')
      .set('authorization', `Bearer ${tokenFor('tg-1')}`);

    expect(res.status).toBe(200);
  });

  it('takes effect on the next request once primed, with no lookup at all', async () => {
    // What the admin route does the moment it suspends someone. Without it an
    // administrator watches the cheat keep playing for a TTL and concludes the
    // button did nothing.
    const lookup = jest.fn(async () => ({ suspendedAt: null }));
    const gate = new SuspensionGate({ lookup });
    const app = appWithGate(gate);

    const before = await request(app)
      .get('/protected')
      .set('authorization', `Bearer ${tokenFor('p-1')}`);
    expect(before.status).toBe(200);

    gate.prime('p-1', true);

    const after = await request(app)
      .get('/protected')
      .set('authorization', `Bearer ${tokenFor('p-1')}`);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('account_suspended');
  });

  it('lets them back in the moment they are reinstated', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: new Date() }) });
    const app = appWithGate(gate);

    gate.prime('p-1', true);
    expect((await request(app).get('/protected').set('authorization', `Bearer ${tokenFor('p-1')}`)).status).toBe(401);

    gate.prime('p-1', false);
    expect((await request(app).get('/protected').set('authorization', `Bearer ${tokenFor('p-1')}`)).status).toBe(200);
  });

  it('does not turn a lookup outage into a mass sign-out', async () => {
    // The failure mode that matters more than the feature. If the identity
    // store is unreachable, every honest player must keep their session.
    const gate = new SuspensionGate({
      lookup: async () => {
        throw new Error('mongo is down');
      },
    });

    const res = await request(appWithGate(gate))
      .get('/protected')
      .set('authorization', `Bearer ${tokenFor('p-1')}`);

    expect(res.status).toBe(200);
  });

  it('still rejects a missing or forged token before any of this', async () => {
    const gate = new SuspensionGate({ lookup: async () => ({ suspendedAt: null }) });
    const app = appWithGate(gate);

    expect((await request(app).get('/protected')).status).toBe(401);

    const forged = signToken({ playerId: 'p-1', role: 'player' }, 'wrong-secret', 3600);
    expect((await request(app).get('/protected').set('authorization', `Bearer ${forged}`)).status).toBe(401);
  });
});
