import { createHash } from 'node:crypto';
import { generateRandomSplit, shufflePackets } from './engine/distribution/randomSplit';

/**
 * The packet split, made PROVABLY FAIR.
 *
 * `generateRandomSplit` and `shufflePackets` already take an injected `randomFn`
 * — they were written for testability, and that is exactly the seam a fair
 * shuffle needs. Feeding them a stream derived from a server seed makes the
 * whole split a pure function of that seed, so it can be COMMITTED before
 * anyone claims and verified afterwards.
 *
 * Why that matters here more than in most games: in 红包扫雷 the amounts ARE
 * the dice. Whether a claim hits the mine is decided by the last digit of the
 * packet it got, so a banker who could re-roll the split after seeing who was
 * about to claim would decide who loses. The commitment is what makes that
 * impossible rather than merely against the rules.
 */

/** The pre-claim commitment: SHA256(serverSeed). Same construction as the mine grid's. */
export function splitCommit(serverSeed: string): string {
  return createHash('sha256').update(serverSeed).digest('hex');
}

/**
 * A deterministic [0, 1) stream from a seed.
 *
 * Counter-mode SHA256: each call hashes `${seed}:${n++}` and reads the first 6
 * bytes as a fraction. Six bytes (48 bits) is well inside the 53 bits a double
 * carries exactly, so no value is ever rounded into or out of range, and the
 * stream never repeats for a given seed.
 *
 * Not `Math.random` seeded by anything — there is no such thing in Node, and a
 * cheap LCG would make the split predictable from a couple of observed rounds,
 * which for this game means predicting who takes the mine.
 */
function seededRandom(serverSeed: string): () => number {
  let counter = 0;
  return () => {
    const digest = createHash('sha256').update(`${serverSeed}:${counter++}`).digest();
    // Read 6 bytes big-endian and divide by 2^48.
    const value = digest.readUIntBE(0, 6);
    return value / 0x1_00_00_00_00_00_00;
  };
}

/**
 * Split `totalAmount` into `packetCount` packets, deterministically from the seed.
 *
 * Amounts are TABLE CHIPS — whole numbers, like every other stake in a live
 * room. `minAmount` is 1: a packet worth nothing is not a packet, and the
 * splitter refuses a total too small to give every packet at least that.
 */
export function splitFromSeed(
  serverSeed: string,
  totalAmount: number,
  packetCount: number,
  minAmount = 1,
): number[] {
  const rng = seededRandom(serverSeed);
  const packets = generateRandomSplit({ totalAmount, packetCount, minAmount }, rng);
  return shufflePackets(packets, rng);
}
