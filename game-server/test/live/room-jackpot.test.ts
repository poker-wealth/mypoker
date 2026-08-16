import { RoomJackpot } from '../../src/live/room-jackpot';

describe('RoomJackpot — Generalized Jackpot Engine Across All Tables', () => {
  it('instantiates for any table id and handles hand evaluations', () => {
    const rj = new RoomJackpot('baccarat-1');
    expect(rj.tableId).toBe('baccarat-1');
    expect(rj.snapshot()).toBeNull();

    const candidates = [
      { playerId: 'alice', baseWeight: 100, behavior: 'NORMAL' as const, associated: false },
      { playerId: 'bob', baseWeight: 100, behavior: 'NORMAL' as const, associated: false },
    ];

    const hits = rj.evaluateHand(1_000, candidates, 'round-1', 'seed-1', (id) => id.toUpperCase());
    expect(Array.isArray(hits)).toBe(true);
  });
});
