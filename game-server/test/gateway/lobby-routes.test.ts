import request from 'supertest';
import { createGatewayApp } from '../../src/gateway/app';
import { loadConfig } from '../../src/gateway/config';
import { LobbyService } from '../../src/lobby';

const $ = (dollars: number): number => dollars * 1_000_000;

function seededLobby(): LobbyService {
  const lobby = new LobbyService();
  lobby.addTable({ id: 'tx-1', gameId: 'texas', stakes: $(2), players: 6, jackpot: $(52) , buyInBB: 40});
  lobby.addTable({ id: 'tx-2', gameId: 'texas', stakes: $(20), players: 4, jackpot: $(128) , buyInBB: 40});
  lobby.addTable({ id: 'nn-1', gameId: 'niu-niu', stakes: $(1), players: 9, jackpot: $(3) , buyInBB: 40});
  return lobby;
}

function app(lobby = seededLobby()) {
  return createGatewayApp(
    loadConfig({ JWT_SECRET: 'test-secret', TELEGRAM_BOT_TOKEN: 'x' } as NodeJS.ProcessEnv),
    lobby,
  );
}

describe('GET /lobby/games', () => {
  it('returns one row per game with pooled players and jackpot', async () => {
    const res = await request(app()).get('/lobby/games');

    expect(res.status).toBe(200);
    const texas = res.body.games.find((g: { gameId: string }) => g.gameId === 'texas');
    expect(texas.tables).toBe(2);
    expect(texas.players).toBe(10);
    expect(texas.jackpot).toBe($(180));
  });

  it('reports the platform-wide jackpot total', async () => {
    const res = await request(app()).get('/lobby/games');
    expect(res.body.totalJackpot).toBe($(183));
  });

  it('is public — the shop window needs no token', async () => {
    const res = await request(app()).get('/lobby/games');
    expect(res.status).toBe(200);
  });
});

describe('GET /lobby/tables', () => {
  it('lists every table when unfiltered', async () => {
    const res = await request(app()).get('/lobby/tables');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });

  it('filters by game', async () => {
    const res = await request(app()).get('/lobby/tables?gameId=texas');
    expect(res.body.count).toBe(2);
    expect(res.body.tables.every((t: { gameId: string }) => t.gameId === 'texas')).toBe(true);
  });

  it('filters by stake range', async () => {
    const res = await request(app()).get(`/lobby/tables?minStakes=${$(5)}`);
    expect(res.body.tables.map((t: { id: string }) => t.id)).toEqual(['tx-2']);
  });

  it('coerces the boolean filters from query strings', async () => {
    // Query params arrive as strings; 'false' is truthy in JS, so a naive
    // implementation would treat hasSeats=false as hasSeats=true.
    const res = await request(app()).get('/lobby/tables?hasSeats=false');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });

  it('rejects an unknown game rather than silently returning everything', async () => {
    const res = await request(app()).get('/lobby/tables?gameId=not-a-game');
    expect(res.status).toBe(400);
  });

  it('404s an unknown table', async () => {
    const res = await request(app()).get('/lobby/tables/nope');
    expect(res.status).toBe(404);
  });

  it('returns a known table with its derived view', async () => {
    const res = await request(app()).get('/lobby/tables/tx-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('tx-1');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('seatsFree');
  });
});

describe('/me routes', () => {
  it('requires a token', async () => {
    const res = await request(app()).get('/me/stats');
    expect(res.status).toBe(401);
  });

  it('requires a token for history too', async () => {
    const res = await request(app()).get('/me/history');
    expect(res.status).toBe(401);
  });
});
