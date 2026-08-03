import {
  serverCommitOf,
  computeFinalSeed,
  computeRoundHash,
  mergeClientSeeds,
  type SeatedClientSeed,
} from './seed';
import { shuffledDeck } from './shuffle';
import { MerkleTree, type ProofNode } from './merkle';

/**
 * The 6-step verifier (FairPlay v6.0). Pure, dependency-light, and reuses the exact production
 * functions — so anyone can re-run it offline against the published round data and confirm the deal
 * was fair and untampered. Each step maps directly to the spec:
 *
 *   1. SHA256(server_seed) === server_commit            (server didn't swap its seed)
 *   2. final_seed === SHA256(server + clients + block + round)
 *   3. all_client_seeds is the merge of every seated player's seed (your seed is included)
 *   4. Fisher-Yates(final_seed) reproduces the exact deck
 *   5. round_hash === SHA256(7 fields)                  (nothing about the round was altered)
 *   6. Merkle proof rebuilds the on-chain root          (round is in the notarized batch)
 */

export interface RoundVerificationData {
  roundId: string;
  serverSeed: string;
  serverCommit: string;
  allClientSeeds: string;
  futureBlockHash: string;
  finalSeed: string;
  cards: string[];
  timestamp: number;
  roundHash: string;
  merkleProof: ProofNode[];
  merkleRoot: string;
  /** Every seated player's seed, in seat order — needed to verify step 3. */
  seatedClientSeeds: SeatedClientSeed[];
  /**
   * How THIS game's deck is derived from the final seed. Defaults to the standard 52-card shuffle.
   *
   * Variants deal from a different deck — Short Deck strips the 2s–5s, so its 36-card order would
   * never match a 52-card re-shuffle. Passing the variant's own builder lets step 4 check the deck
   * that was ACTUALLY dealt, rather than silently verifying the wrong one.
   */
  deckFor?: (finalSeed: string) => string[];
}

export interface VerificationResult {
  step1_serverCommit: boolean;
  step2_finalSeed: boolean;
  step3_clientSeeds: boolean;
  step4_deck: boolean;
  step5_roundHash: boolean;
  step6_merkle: boolean;
  allPass: boolean;
}

export function verifyRound(d: RoundVerificationData): VerificationResult {
  const step1 = serverCommitOf(d.serverSeed) === d.serverCommit;

  const step2 =
    computeFinalSeed(d.serverSeed, d.allClientSeeds, d.futureBlockHash, d.roundId) === d.finalSeed;

  const step3 = mergeClientSeeds(d.seatedClientSeeds) === d.allClientSeeds;

  const buildDeck = d.deckFor ?? shuffledDeck;
  const step4 = JSON.stringify(buildDeck(d.finalSeed)) === JSON.stringify(d.cards);

  const step5 =
    computeRoundHash({
      roundId: d.roundId,
      serverCommit: d.serverCommit,
      allClientSeeds: d.allClientSeeds,
      futureBlockHash: d.futureBlockHash,
      finalSeed: d.finalSeed,
      cards: d.cards,
      timestamp: d.timestamp,
    }) === d.roundHash;

  const step6 = MerkleTree.verify(d.roundHash, d.merkleProof, d.merkleRoot);

  return {
    step1_serverCommit: step1,
    step2_finalSeed: step2,
    step3_clientSeeds: step3,
    step4_deck: step4,
    step5_roundHash: step5,
    step6_merkle: step6,
    allPass: step1 && step2 && step3 && step4 && step5 && step6,
  };
}
