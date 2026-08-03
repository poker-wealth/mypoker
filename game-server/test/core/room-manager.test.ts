import {
  RoomManager,
  RoomExistsError,
  RoomNotFoundError,
  RoomFullError,
  AlreadySeatedError,
  type GameLike,
} from '../../src/core/room-manager';

const game = (min: number, max: number): GameLike => ({ minPlayers: min, maxPlayers: max });

describe('RoomManager', () => {
  it('creates and looks up rooms', () => {
    const rm = new RoomManager();
    const room = rm.create('t1', game(2, 6));
    expect(room.id).toBe('t1');
    expect(rm.get('t1').players).toEqual([]);
    expect(rm.has('t1')).toBe(true);
    expect(rm.size).toBe(1);
  });

  it('rejects duplicate room ids and unknown lookups', () => {
    const rm = new RoomManager();
    rm.create('t1', game(2, 6));
    expect(() => rm.create('t1', game(2, 6))).toThrow(RoomExistsError);
    expect(() => rm.get('nope')).toThrow(RoomNotFoundError);
  });

  it('seats players up to capacity', () => {
    const rm = new RoomManager();
    rm.create('t1', game(2, 2));
    rm.join('t1', 'p1');
    rm.join('t1', 'p2');
    expect(rm.get('t1').players).toEqual(['p1', 'p2']);
    expect(() => rm.join('t1', 'p3')).toThrow(RoomFullError);
  });

  it('enforces one table per player (anti-bot single-table foundation)', () => {
    const rm = new RoomManager();
    rm.create('t1', game(2, 6));
    rm.create('t2', game(2, 6));
    rm.join('t1', 'p1');
    expect(() => rm.join('t2', 'p1')).toThrow(AlreadySeatedError);
    expect(rm.roomOf('p1')).toBe('t1');
  });

  it('lets a player move tables after leaving', () => {
    const rm = new RoomManager();
    rm.create('t1', game(2, 6));
    rm.create('t2', game(2, 6));
    rm.join('t1', 'p1');
    rm.leave('t1', 'p1');
    expect(rm.roomOf('p1')).toBeUndefined();
    rm.join('t2', 'p1'); // now allowed
    expect(rm.roomOf('p1')).toBe('t2');
  });

  it('removing a room frees its seats', () => {
    const rm = new RoomManager();
    rm.create('t1', game(2, 6));
    rm.join('t1', 'p1');
    rm.remove('t1');
    expect(rm.has('t1')).toBe(false);
    rm.create('t2', game(2, 6));
    rm.join('t2', 'p1'); // p1 is free again
    expect(rm.roomOf('p1')).toBe('t2');
  });
});
