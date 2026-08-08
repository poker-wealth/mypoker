import { createHash } from 'node:crypto';
import {
  generateServerCommitment,
  generateClientSeed,
  mergeClientSeeds,
  computeFinalSeed,
  computeRoundHash,
  shuffledDeck,
  MerkleTree,
  verifyRound,
} from '../src/fairness/index';

/**
 * Regenerate the browser verifier's test fixture.
 *
 *   npx ts-node scripts/gen-fairness-vector.ts > \
 *     ../frontend/src/lib/__fixtures__/round-vector.json
 *
 * The frontend re-implements the 6-step verification so a player can check a hand
 * without trusting us (frontend/src/lib/fairness.ts). Its tests pin that port to
 * THIS implementation by running it against a round built here with the real
 * production functions — so if the seed pipeline ever legitimately changes, the
 * fix is to regenerate this fixture, not to edit the expectations.
 *
 * Every value is produced by the shipped code. Nothing is hand-written, because a
 * hand-written vector would only ever prove the verifier agrees with whoever
 * typed it.
 */

const { serverSeed, serverCommit } = generateServerCommitment();

const seatedClientSeeds = Array.from({ length: 6 }, (_, i) => ({
  seatOrder: i + 1,
  clientSeed: generateClientSeed(),
}));
const allClientSeeds = mergeClientSeeds(seatedClientSeeds);

const futureBlockHash = 'a'.repeat(64);
const roundId = 'round-vector-0001';
const finalSeed = computeFinalSeed(serverSeed, allClientSeeds, futureBlockHash, roundId);
const cards = shuffledDeck(finalSeed);
const timestamp = 1_770_000_000_000;

const roundHash = computeRoundHash({
  roundId,
  serverCommit,
  allClientSeeds,
  futureBlockHash,
  finalSeed,
  cards,
  timestamp,
});

// Notarize alongside siblings so the proof has real depth rather than being a
// single-leaf tree, where step 6 would pass trivially.
//
// The siblings must be valid hex: hashPair decodes them to raw bytes, and an
// earlier version of this script padded a label to 64 characters instead. Node
// silently decoded that to zero bytes while the browser decoded it to garbage,
// and step 6 disagreed across implementations for reasons that had nothing to do
// with either implementation.
const siblings = Array.from({ length: 7 }, (_, i) =>
  createHash('sha256').update(`other-round-${i}`).digest('hex'),
);
const tree = new MerkleTree([roundHash, ...siblings]);

const vector = {
  roundId,
  serverSeed,
  serverCommit,
  allClientSeeds,
  futureBlockHash,
  finalSeed,
  cards,
  timestamp,
  roundHash,
  merkleProof: tree.getProof(0),
  merkleRoot: tree.root,
  seatedClientSeeds,
  // Step 6b: where this batch's root was anchored. The sample vector carries a
  // dev token, which the page renders as "not yet anchored" rather than as a
  // link — exactly what a fake deserves. A round notarized by the real Solana
  // client carries its transaction signature here instead.
  notarization: {
    chain: 'solana' as const,
    tx: `fake-tx-${createHash('sha256').update(tree.root).digest('hex').slice(0, 16)}`,
  },
};

// The server's own verifier must accept it before it is worth comparing against.
const check = verifyRound(vector);
if (!check.allPass) {
  console.error('server verifier rejected its own vector:', check);
  process.exit(1);
}

console.log(JSON.stringify(vector, null, 2));
