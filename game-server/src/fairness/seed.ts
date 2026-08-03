import { createHash, randomBytes } from 'node:crypto';

/**
 * Provably-fair seed pipeline (FairPlay v6.0 UltraFair).
 *
 * Three independent randomness sources combine so no single party can predict the deck:
 *   - server_seed        (platform; committed before dealing, revealed after)
 *   - all_client_seeds   (players; each contributes a locally-generated seed)
 *   - future_block_hash  (a future blockchain block nobody knows at commit time)
 *
 *   final_seed = SHA256(server_seed + all_client_seeds + future_block_hash + round_id)
 *
 * The exact concatenation here IS the verification contract — the offline verifier reuses these
 * same functions, so what the server computes and what a player checks can never drift.
 */

function sha256hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface ServerCommitment {
  serverSeed: string;
  serverCommit: string;
}

/** Generate the server seed and its commitment (written to durable storage BEFORE dealing). */
export function generateServerCommitment(): ServerCommitment {
  const serverSeed = randomBytes(32).toString('hex');
  return { serverSeed, serverCommit: sha256hex(serverSeed) };
}

export function serverCommitOf(serverSeed: string): string {
  return sha256hex(serverSeed);
}

/** A player's locally-generated client seed (in production this is created on the device). */
export function generateClientSeed(): string {
  return randomBytes(32).toString('hex');
}

export interface SeatedClientSeed {
  seatOrder: number;
  clientSeed: string;
}

/**
 * Merge all seated players' client seeds: concatenate in seat order, then hash.
 *   all_client_seeds = SHA256(C1 ‖ C2 ‖ … ‖ Cn)
 */
export function mergeClientSeeds(seeds: readonly SeatedClientSeed[]): string {
  const ordered = [...seeds].sort((a, b) => a.seatOrder - b.seatOrder).map((s) => s.clientSeed);
  return sha256hex(ordered.join(''));
}

/** Deterministic backup seed for a player who times out (rules pre-published, auditable). */
export function backupClientSeed(roundId: string, playerId: string, serverNonce: string): string {
  return sha256hex(`${roundId}:${playerId}:${serverNonce}`);
}

/** final_seed = SHA256(server_seed + all_client_seeds + future_block_hash + round_id). */
export function computeFinalSeed(
  serverSeed: string,
  allClientSeeds: string,
  futureBlockHash: string,
  roundId: string,
): string {
  return sha256hex(serverSeed + allClientSeeds + futureBlockHash + roundId);
}

export interface RoundHashInput {
  roundId: string;
  serverCommit: string;
  allClientSeeds: string;
  futureBlockHash: string;
  finalSeed: string;
  cards: readonly string[];
  timestamp: number;
}

/**
 * round_hash — the tamper-evident digest of a whole round (7 fields, v6.0). Including server_commit
 * (locked before the future block was known) is what stops a platform rewriting history.
 */
export function computeRoundHash(input: RoundHashInput): string {
  return sha256hex(
    input.roundId +
      input.serverCommit +
      input.allClientSeeds +
      input.futureBlockHash +
      input.finalSeed +
      JSON.stringify(input.cards) +
      input.timestamp.toString(),
  );
}
