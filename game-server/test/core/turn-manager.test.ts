import { TurnManager } from '../../src/core/turn-manager';

describe('TurnManager', () => {
  it('starts at the first seat and advances in order, wrapping', () => {
    const tm = new TurnManager(['a', 'b', 'c']);
    expect(tm.current).toBe('a');
    expect(tm.advance()).toBe('b');
    expect(tm.advance()).toBe('c');
    expect(tm.advance()).toBe('a'); // wraps
  });

  it('completes a round once every active player has acted', () => {
    const tm = new TurnManager(['a', 'b', 'c']);
    tm.markActed('a');
    tm.markActed('b');
    expect(tm.isRoundComplete()).toBe(false);
    tm.markActed('c');
    expect(tm.isRoundComplete()).toBe(true);
    tm.resetRound();
    expect(tm.isRoundComplete()).toBe(false);
  });

  it('removing the current player moves the turn to the next active', () => {
    const tm = new TurnManager(['a', 'b', 'c']);
    expect(tm.current).toBe('a');
    tm.remove('a'); // a folds on their turn
    expect(tm.current).toBe('b');
    expect(tm.activePlayers()).toEqual(['b', 'c']);
  });

  it('a folded player no longer blocks round completion', () => {
    const tm = new TurnManager(['a', 'b', 'c']);
    tm.markActed('a');
    tm.remove('b'); // b folds without acting
    tm.markActed('c');
    expect(tm.isRoundComplete()).toBe(true); // only a and c needed to act
  });

  it('with a single active player, advance returns that player', () => {
    const tm = new TurnManager(['a', 'b']);
    tm.remove('b');
    expect(tm.current).toBe('a');
    expect(tm.advance()).toBe('a');
    expect(tm.activeCount).toBe(1);
  });

  it('returns null when no players are active', () => {
    const tm = new TurnManager(['a']);
    tm.remove('a');
    expect(tm.current).toBeNull();
    expect(tm.advance()).toBeNull();
  });

  it('rejects an empty seat order', () => {
    expect(() => new TurnManager([])).toThrow();
  });
});
