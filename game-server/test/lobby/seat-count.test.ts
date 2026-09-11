import { LobbyService } from '../../src/lobby/lobby-service';

/**
 * A table must advertise ITS OWN seats, not the game's ceiling.
 *
 * Written because the fix for that shipped without one: the existing lobby
 * suites passed, which proved only that nothing broke. Victor asked "are u sure
 * this players stuff was corrected", and the honest answer was that nothing
 * asserted it. This does.
 */
describe('lobby seat count', () => {
  const base = {
    gameId: 'texas' as const,
    stakes: 2,
    players: 0,
    jackpot: 0,
    buyInBB: 100,
  };

  it('reports the seats the creator chose, not the game ceiling', () => {
    const lobby = new LobbyService();
    lobby.addTable({ ...base, id: 't-two', seats: 2 });
    const row = lobby.listTables()[0]!;
    expect(row.maxPlayers).toBe(2);
    expect(row.seatsFree).toBe(2);
  });

  it('is FULL at its own seat count, not the ceiling', () => {
    const lobby = new LobbyService();
    lobby.addTable({ ...base, id: 't-two', seats: 2, players: 2 });
    // Before the fix this read OPEN, because 2 < the catalogue's 8.
    expect(lobby.listTables()[0]!.status).toBe('FULL');
  });

  it('falls back to the catalogue when a table sets no seats', () => {
    const lobby = new LobbyService();
    lobby.addTable({ ...base, id: 't-house' });
    expect(lobby.listTables()[0]!.maxPlayers).toBe(8);
  });

  it('clamps a row that claims more seats than the engine deals to', () => {
    const lobby = new LobbyService();
    lobby.addTable({ ...base, id: 't-liar', seats: 99 });
    expect(lobby.listTables()[0]!.maxPlayers).toBe(8);
  });

  it('picks up seats from the resync patch', () => {
    const lobby = new LobbyService();
    lobby.addTable({ ...base, id: 't-late' });
    lobby.updateTable('t-late', { seats: 4 });
    expect(lobby.listTables()[0]!.maxPlayers).toBe(4);
  });
});
