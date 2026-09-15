import express from 'express';
import request from 'supertest';
import { loadConfig } from '../../src/gateway/config';
import { buildPlayerTableRouter } from '../../src/gateway/player-table-routes';
import { signToken, verifyToken } from '../../src/gateway/tokens';
import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { TableHub } from '../../src/live/table-hub';
import type { LobbyService } from '../../src/lobby';

/**
 * `POST /tables/join` — the lobby's "Enter game PIN to join", over HTTP.
 *
 * `table-access.test.ts` proves the PIN policy. This proves the route reaches
 * it: a table opened through `POST /tables` can be found by the PIN that route
 * handed back, a private one is then actually unlocked for the guest, and the
 * refusals come back as the statuses the lobby screen reads.
 */

const JWT_SECRET = 'test-secret-table-join';

const tokenFor = (playerId: string): string => signToken({ playerId, role: 'player' }, JWT_SECRET, 300);

describe('POST /tables/join', () => {
  let hub: TableHub;
  let app: express.Express;

  beforeEach(() => {
    const players = new DevPlayers({ startingChips: 10_000 });
    hub = new TableHub({ directory: players, fc: new ChipBank(players) }, (token) => ({
      playerId: verifyToken(token, JWT_SECRET).playerId,
    }));
    // Only a PUBLIC create lists itself in the lobby, inside a try/catch; a stub is enough.
    const lobby = { addTable: () => undefined } as unknown as LobbyService;
    const config = loadConfig({
      JWT_SECRET,
      NODE_ENV: 'test',
      FINANCIAL_CORE_URL: 'http://127.0.0.1:9',
    } as NodeJS.ProcessEnv);

    app = express();
    app.use(express.json());
    app.use('/tables', buildPlayerTableRouter(config, { hub, lobby }));
  });

  afterEach(async () => {
    await hub.close();
  });

  const create = async (visibility: 'public' | 'private', creator = 'creator') =>
    request(app)
      .post('/tables')
      .set('authorization', `Bearer ${tokenFor(creator)}`)
      .send({ game: 'texas', visibility });

  const join = (playerId: string, pin: unknown) =>
    request(app).post('/tables/join').set('authorization', `Bearer ${tokenFor(playerId)}`).send({ pin });

  it('hands back a PIN on create — for a private table, the same digits as its code', async () => {
    const priv = await create('private');
    expect(priv.status).toBe(201);
    expect(priv.body.pin).toMatch(/^\d{6}$/);
    expect(priv.body.pin).toBe(priv.body.joinCode);

    const pub = await create('public');
    expect(pub.status).toBe(201);
    expect(pub.body.joinCode).toBeNull();
    expect(pub.body.pin).toMatch(/^\d{6}$/);
  });

  it('finds a private table by its PIN and unlocks it for the guest', async () => {
    const created = await create('private');

    const res = await join('guest', created.body.pin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tableId: created.body.tableId });

    // Unlocked: the per-table unlock now answers ok without the code being sent again.
    const unlock = await request(app)
      .post(`/tables/${created.body.tableId}/unlock`)
      .set('authorization', `Bearer ${tokenFor('guest')}`)
      .send({ code: created.body.pin });
    expect(unlock.status).toBe(200);
  });

  it('finds a public table by its PIN', async () => {
    const created = await create('public');

    const res = await join('guest', created.body.pin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tableId: created.body.tableId });
  });

  it('404s a PIN that matches nothing', async () => {
    const created = await create('private');
    const wrong = created.body.pin === '000000' ? '111111' : '000000';

    const res = await join('guest', wrong);
    expect(res.status).toBe(404);
  });

  it('429s once a player has spent their guesses, even on the right PIN', async () => {
    const created = await create('private');
    const wrong = created.body.pin === '000000' ? '111111' : '000000';

    for (let i = 0; i < 10; i += 1) expect((await join('attacker', wrong)).status).toBe(404);
    expect((await join('attacker', created.body.pin)).status).toBe(429);
    // Twelve authenticated round trips, each through the suspension gate — far
    // past jest's 5s default on a loaded machine, and nothing to do with the route.
  }, 60_000);

  it('400s anything that is not six digits, without spending a guess', async () => {
    const created = await create('private');

    for (const bad of ['12345', '1234567', 'abcdef', 694023, undefined]) {
      expect((await join('guest', bad)).status).toBe(400);
    }
    expect((await join('guest', created.body.pin)).status).toBe(200);
  });

  it('401s without a session', async () => {
    const res = await request(app).post('/tables/join').send({ pin: '123456' });
    expect(res.status).toBe(401);
  });
});
