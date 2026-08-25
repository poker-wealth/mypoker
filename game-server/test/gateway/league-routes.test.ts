import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { LobbyService } from '../../src/lobby';

/**
 * The gateway's league reads.
 *
 * These routes are thin forwards to financial-core, which owns the rules and is
 * tested there. What can only be checked HERE is which of them carry the
 * caller's identity, and that is not cosmetic:
 *
 * `/leagues/:id/members` is members-only, and financial-core decides that from
 * the token. Forwarding it WITHOUT `requireAuth` would send an anonymous
 * request, financial-core would find no membership, and every roster read would
 * 404 — for everyone, forever, with nothing in the logs to say why. The failure
 * looks exactly like "that league does not exist".
 *
 * The two public reads are here for the contrast: they must NOT start
 * demanding a token, because a signed-out player browsing alliances is the
 * normal case.
 */

function app() {
  return createGatewayApp(
    loadConfig({ JWT_SECRET: 'test-secret', TELEGRAM_BOT_TOKEN: 'x' } as NodeJS.ProcessEnv),
    new LobbyService(),
  );
}

describe('gateway league routes — which ones carry identity', () => {
  it('refuses an unauthenticated roster read rather than forwarding it anonymously', async () => {
    const res = await request(app()).get('/leagues/lg-1/members');

    // 401, NOT 404: the difference between "you are not signed in" and "no such
    // league" is the whole point. A missing requireAuth would produce the 404.
    expect(res.status).toBe(401);
  });

  it('leaves discovery open to a signed-out player', async () => {
    const res = await request(app()).get('/leagues');
    expect(res.status).not.toBe(401);
  });

  it('leaves a single league open to a signed-out player', async () => {
    const res = await request(app()).get('/leagues/lg-1');
    expect(res.status).not.toBe(401);
  });

  it('requires a token to create, join or leave', async () => {
    const created = await request(app()).post('/leagues').send({ leagueId: 'lg-1', name: 'X' });
    const joined = await request(app()).post('/leagues/lg-1/join').send({});
    const left = await request(app()).post('/leagues/lg-1/leave').send({});

    expect(created.status).toBe(401);
    expect(joined.status).toBe(401);
    expect(left.status).toBe(401);
  });
});
