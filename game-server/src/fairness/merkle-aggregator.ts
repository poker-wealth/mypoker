import { MerkleTree, type ProofNode } from './merkle';
import type { ChainClient } from './chain';

/**
 * MerkleAggregator (FairPlay v5.9.1) — batches round hashes, builds a Merkle tree, stores a proof
 * for every round, and commits only the ROOT on-chain. Runs in the background, fully decoupled from
 * gameplay. A batch commits when it reaches `batchSize` (or when explicitly flushed off-peak).
 *
 * This cuts on-chain cost ~99% vs per-round commits while keeping every round verifiable.
 */

export interface MerkleRecord {
  roundId: string;
  roundHash: string;
  merkleProof: ProofNode[];
  merkleRoot: string;
  chainTx: string | null;
  batchFrom: string;
  batchTo: string;
}

export interface MerkleStore {
  save(records: MerkleRecord[]): void | Promise<void>;
  get(roundId: string): MerkleRecord | undefined | Promise<MerkleRecord | undefined>;
}

export class InMemoryMerkleStore implements MerkleStore {
  private readonly byRound = new Map<string, MerkleRecord>();
  save(records: MerkleRecord[]): void {
    for (const r of records) this.byRound.set(r.roundId, r);
  }
  get(roundId: string): MerkleRecord | undefined {
    return this.byRound.get(roundId);
  }
  get size(): number {
    return this.byRound.size;
  }
}

export class MerkleAggregator {
  private queue: { roundId: string; roundHash: string }[] = [];

  constructor(
    private readonly chain: ChainClient,
    private readonly store: MerkleStore,
    private readonly batchSize = 100,
  ) {}

  /** Queue a settled round. Commits the batch automatically once it is full. */
  async addRound(roundId: string, roundHash: string): Promise<void> {
    this.queue.push({ roundId, roundHash });
    if (this.queue.length >= this.batchSize) await this.commitBatch();
  }

  /** Force-commit any queued rounds (off-peak time-window trigger / shutdown). */
  async flush(): Promise<void> {
    if (this.queue.length > 0) await this.commitBatch();
  }

  get pending(): number {
    return this.queue.length;
  }

  private async commitBatch(): Promise<void> {
    const batch = this.queue;
    this.queue = [];

    const tree = new MerkleTree(batch.map((b) => b.roundHash));
    const merkleRoot = tree.root;
    const batchFrom = batch[0]!.roundId;
    const batchTo = batch[batch.length - 1]!.roundId;

    const tx = await this.chain.commitMerkleRoot({
      merkleRoot,
      roundCount: batch.length,
      fromRoundId: batchFrom,
      toRoundId: batchTo,
    });

    const records: MerkleRecord[] = batch.map((b, i) => ({
      roundId: b.roundId,
      roundHash: b.roundHash,
      merkleProof: tree.getProof(i),
      merkleRoot,
      chainTx: tx,
      batchFrom,
      batchTo,
    }));
    await this.store.save(records);
  }
}
