import { createHash } from 'node:crypto';

/**
 * Seeded, replayable randomness for games that need a number rather than a shuffle
 * (slot reels, lottery draws).
 *
 * Same seed → same stream, on any machine, forever: that is what lets a player re-derive a spin or a
 * draw from the revealed seed and check it was never altered.
 */

/** Endless uint32 stream: SHA256(seed:block) read four bytes at a time. */
export function* uint32Stream(seed: string): Generator<number> {
  for (let block = 0; ; block++) {
    const digest = createHash('sha256').update(`${seed}:${block}`).digest();
    for (let o = 0; o + 4 <= digest.length; o += 4) yield digest.readUInt32BE(o);
  }
}

/**
 * A uniform integer in [0, n) via rejection sampling.
 *
 * Plain `roll % n` would make the low numbers likelier whenever n does not divide 2³² — a small bias,
 * but a real one, and in a game it is a thumb on the scale. Discarding the short tail removes it.
 */
export function uniformBelow(rng: Generator<number>, n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('n must be a positive integer');
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  let roll: number;
  do {
    roll = rng.next().value as number;
  } while (roll >= limit);
  return roll % n;
}
