import {
  generateMineGrid,
  gridCommit,
  verifyGrid,
  safeMultiplierBps,
} from '../../../src/games/red-packet/mine-grid';

describe('mine grid', () => {
  it('places the exact number of mines, deterministically', () => {
    const a = generateMineGrid('seed-1', 25, 5);
    const b = generateMineGrid('seed-1', 25, 5);
    expect(a.size).toBe(5);
    expect([...a].every((i) => i >= 0 && i < 25)).toBe(true);
    expect([...a].sort()).toEqual([...b].sort()); // same seed → same grid
  });

  it('different seeds give different grids', () => {
    const a = [...generateMineGrid('seed-1', 25, 5)].sort();
    const b = [...generateMineGrid('seed-2', 25, 5)].sort();
    expect(a).not.toEqual(b);
  });

  it('verifies a revealed seed against its pre-bet commit', () => {
    const seed = 'abc123';
    const commit = gridCommit(seed);
    const layout = verifyGrid(seed, commit, 25, 5);
    expect(layout).not.toBeNull();
    expect(layout!.size).toBe(5);
    // A tampered seed fails verification.
    expect(verifyGrid('wrong-seed', commit, 25, 5)).toBeNull();
  });

  it('computes the safe-cell multiplier', () => {
    // 25 cells, 5 mines → 20 safe → 25/20 = 1.25×
    expect(safeMultiplierBps(25, 5)).toBe(12500);
  });
});
