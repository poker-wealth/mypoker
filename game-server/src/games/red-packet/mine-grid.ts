import { createHash } from 'node:crypto';
import { shuffle } from '../../fairness/shuffle';

/**
 * Red Packet Minesweeper — provably-fair mine grid.
 *
 * The mine layout is fully determined by a server seed and COMMITTED (SHA256 of the seed) BEFORE any
 * bet is placed. After betting closes the seed is revealed; anyone recomputes the layout and checks
 * the commit — proving the mines were fixed in advance and never moved to make a player lose.
 */

/** Place `mineCount` mines among `size` cells deterministically from `serverSeed`. */
export function generateMineGrid(serverSeed: string, size: number, mineCount: number): Set<number> {
  if (mineCount < 0 || mineCount >= size) throw new RangeError('mineCount must be in [0, size)');
  const indices = Array.from({ length: size }, (_, i) => String(i));
  const shuffled = shuffle(indices, serverSeed);
  return new Set(shuffled.slice(0, mineCount).map(Number));
}

/** The pre-bet commitment: SHA256(serverSeed). */
export function gridCommit(serverSeed: string): string {
  return createHash('sha256').update(serverSeed).digest('hex');
}

/** Verify a revealed seed against its commit and return the recomputed mine layout, or null. */
export function verifyGrid(
  serverSeed: string,
  commit: string,
  size: number,
  mineCount: number,
): Set<number> | null {
  if (gridCommit(serverSeed) !== commit) return null;
  return generateMineGrid(serverSeed, size, mineCount);
}

/** Safe-cell payout multiplier in basis points: size / (size − mines). */
export function safeMultiplierBps(size: number, mineCount: number): number {
  return Math.floor((size * 10000) / (size - mineCount));
}
