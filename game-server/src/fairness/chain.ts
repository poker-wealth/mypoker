import { createHash } from 'node:crypto';

/**
 * ChainClient — the blockchain notary abstraction (FairPlay v6.0).
 *
 * The game uses it for the future-block randomness source and to commit Merkle roots. The real
 * implementation talks to Solana (devnet now, mainnet at launch); the fake here is deterministic
 * for dev/tests. Per the iron rule, NONE of this is ever in the game critical path — it's async.
 */

export interface CommitRootArgs {
  merkleRoot: string;
  roundCount: number;
  fromRoundId: string;
  toRoundId: string;
}

export interface ChainClient {
  /** Current chain height — `+1` becomes the future block the deal waits on. */
  getLatestBlockNumber(): Promise<number>;
  /** The (eventually finalized) hash of a block — unknown to everyone until it is produced. */
  getBlockHash(blockNumber: number): Promise<string>;
  /** Notarize a batch's Merkle root. Returns a tx id. */
  commitMerkleRoot(args: CommitRootArgs): Promise<string>;
}

/** Deterministic in-memory chain for development and tests. Records what it was asked to commit. */
export class FakeChainClient implements ChainClient {
  readonly commits: CommitRootArgs[] = [];
  private height: number;

  constructor(startHeight = 1000) {
    this.height = startHeight;
  }

  async getLatestBlockNumber(): Promise<number> {
    return this.height++;
  }

  async getBlockHash(blockNumber: number): Promise<string> {
    return createHash('sha256').update(`block:${blockNumber}`).digest('hex');
  }

  async commitMerkleRoot(args: CommitRootArgs): Promise<string> {
    this.commits.push(args);
    return `fake-tx-${createHash('sha256').update(args.merkleRoot).digest('hex').slice(0, 16)}`;
  }
}
