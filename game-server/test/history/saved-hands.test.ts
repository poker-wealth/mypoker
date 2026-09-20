import { saveDecision, SAVED_HAND_LIMIT } from '../../src/history/saved-hands';

/**
 * The star's rule: fifteen saved hands, and a second tap is not a failure.
 *
 * Pure, so it is tested here without a database — the writes themselves are
 * three one-line Mongo calls, and the thing that can actually be got wrong is
 * this decision.
 */
describe('saveDecision', () => {
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `r${i}`);

  it('saves when there is room', () => {
    expect(saveDecision([], 'r-new')).toBe('saved');
    expect(saveDecision(ids(SAVED_HAND_LIMIT - 1), 'r-new')).toBe('saved');
  });

  it('reports a hand already starred rather than spending a slot on it', () => {
    // A second tap on a starred hand must not consume one of the fifteen, and
    // must not read as a failure to the player.
    expect(saveDecision(['r1', 'r2'], 'r2')).toBe('already-saved');
    expect(saveDecision(ids(SAVED_HAND_LIMIT), 'r3')).toBe('already-saved');
  });

  it('refuses a new hand once the shortlist is full', () => {
    expect(saveDecision(ids(SAVED_HAND_LIMIT), 'r-new')).toBe('full');
  });

  it('keeps the limit the screen prints', () => {
    // The panel draws "n/15". If this moves, that label moves with it.
    expect(SAVED_HAND_LIMIT).toBe(15);
  });
});
