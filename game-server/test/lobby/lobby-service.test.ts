import { LobbyService } from '../../src/lobby/lobby-service';
import { GAME_CATALOG, GAME_IDS, provableGames, withVendor, gameSpec } from '../../src/lobby/game-catalog';

function lobby(): LobbyService {
  const l = new LobbyService();
  l.addTable({ id: 't1', gameId: 'texas', stakes: 100, players: 5, jackpot: 5000 , buyInBB: 40});
  l.addTable({ id: 't2', gameId: 'texas', stakes: 1000, players: 2, jackpot: 20_000 , buyInBB: 40});
  l.addTable({ id: 't3', gameId: 'niu-niu', stakes: 100, players: 2, jackpot: 800 , buyInBB: 40});
  l.addTable({ id: 't4', gameId: 'dou-di-zhu', stakes: 50, players: 3, jackpot: 300 , buyInBB: 40});
  return l;
}

describe('lobby — per-game jackpot and game rail', () => {
  it('sums each game type’s jackpot across all its active tables', () => {
    const games = lobby().listGames();
    const texas = games.find((g) => g.gameId === 'texas')!;
    expect(texas.jackpot).toBe(25_000); // 5000 + 20000
    expect(texas.tables).toBe(2);
    expect(texas.players).toBe(7);
    expect(lobby().totalJackpot()).toBe(26_100);
  });

  it('lists every catalogued game, even with no tables running', () => {
    expect(new LobbyService().listGames()).toHaveLength(GAME_IDS.length);
    expect(new LobbyService().listGames().map((g) => g.gameId)).toEqual(GAME_IDS);
  });
});

describe('lobby — minimum players gate', () => {
  it('a table below its minimum shows WAITING and cannot start', () => {
    const l = lobby();
    // Niu Niu needs 3; t3 has 2.
    const t3 = l.getTable('t3')!;
    expect(t3.status).toBe('WAITING');
    expect(t3.waitingFor).toBe(1);
    expect(l.canStart('t3')).toBe(false);

    l.updateTable('t3', { players: 3 });
    expect(l.getTable('t3')!.status).toBe('OPEN');
    expect(l.canStart('t3')).toBe(true);
  });

  it('a full table is FULL and has no free seats', () => {
    const l = lobby();
    l.updateTable('t4', { players: 3 }); // Dou Di Zhu is exactly 3
    const t4 = l.getTable('t4')!;
    expect(t4.status).toBe('FULL');
    expect(t4.seatsFree).toBe(0);
    expect(l.canStart('t4')).toBe(true);
  });

  it('enforces each game’s own minimum from the catalogue', () => {
    expect(gameSpec('dou-di-zhu').minPlayers).toBe(3);
    expect(gameSpec('niu-niu').minPlayers).toBe(3);
    expect(gameSpec('texas').minPlayers).toBe(2);
  });
});

describe('lobby — vendor outage', () => {
  it('a game whose vendor is down shows UNAVAILABLE and will not start, and the rest keep running', () => {
    const l = lobby();
    l.addTable({ id: 't5', gameId: 'slots', stakes: 10, players: 1, jackpot: 0 , buyInBB: 40});
    l.setAvailability('slots', false); // driven by the circuit breaker

    expect(l.getTable('t5')!.status).toBe('UNAVAILABLE');
    expect(l.canStart('t5')).toBe(false);
    expect(l.listGames().find((g) => g.gameId === 'slots')!.available).toBe(false);

    // Everything else is untouched.
    expect(l.getTable('t1')!.status).toBe('OPEN');
    expect(l.listGames().find((g) => g.gameId === 'texas')!.available).toBe(true);

    l.setAvailability('slots', true);
    expect(l.getTable('t5')!.status).toBe('FULL'); // slots is a 1-seat game
  });
});

describe('lobby — filters', () => {
  it('filters by game, stakes, free seats and jackpot', () => {
    const l = lobby();
    expect(l.listTables({ gameId: 'texas' }).map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect(l.listTables({ minStakes: 1000 }).map((t) => t.id)).toEqual(['t2']);
    // t1 is a 100-stake table with a 5000 jackpot — it satisfies both bounds.
    expect(l.listTables({ maxStakes: 100, minJackpot: 1000 }).map((t) => t.id)).toEqual(['t1']);
    expect(l.listTables({ maxStakes: 100, minJackpot: 6000 }).map((t) => t.id)).toEqual([]);
    expect(l.listTables({ minJackpot: 1000 }).map((t) => t.id)).toEqual(['t2', 't1']); // jackpot desc
    expect(l.listTables({ readyOnly: true }).map((t) => t.id).includes('t3')).toBe(false); // WAITING
  });

  it('sorts by jackpot, biggest first', () => {
    expect(lobby().listTables().map((t) => t.jackpot)).toEqual([20_000, 5000, 800, 300]);
  });
});

describe('catalogue — fairness tier', () => {
  it('every game we own is PROVABLE', () => {
    expect(provableGames()).toHaveLength(GAME_IDS.length);
    expect(Object.values(GAME_CATALOG).every((g) => g.fairness === 'PROVABLE')).toBe(true);
  });

  it('an outside vendor drops to VENDOR_ATTESTED unless it commits its config hash', () => {
    const blackBox = withVendor('slots', 'MatGaming', { commitsConfigHash: false });
    expect(blackBox.fairness).toBe('VENDOR_ATTESTED'); // we must NOT call this tamper-proof
    expect(blackBox.vendor).toBe('MatGaming');

    const committed = withVendor('slots', 'MatGaming', { commitsConfigHash: true });
    expect(committed.fairness).toBe('PROVABLE'); // rules on-chain → it joins the provable tier
  });
});
