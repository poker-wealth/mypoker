import { MerkleAggregator, type MerkleStore } from './merkle-aggregator';
import { computeRoundHash, type SeatedClientSeed } from './seed';
import { persistRound } from './round-store';
import type { ChainClient } from './chain';

/**
 * Round notary — the piece that makes live hands verifiable end-to-end.
 *
 * For every settled round it persists the full fairness data and queues the round hash into the
 * Merkle aggregator, which commits batch ROOTS on-chain (~99% cheaper than per-round). This runs
 * OFF the game's critical path: callers invoke it after settlement and never let it throw into the
 * hand. A periodic flush commits partial batches so low-volume rounds don't wait for a full 100.
 */

export interface NotarizeInput {
  roundId: string;
  serverCommit: string;
  serverSeed: string;
  allClientSeeds: string;
  seatedClientSeeds: SeatedClientSeed[];
  futureBlockHash: string;
  finalSeed: string;
  /** The full shuffled deck derived from finalSeed — exactly what the verifier re-checks (step 4). */
  cards: string[];
  timestamp: number;
  /** The committed rule version in force for this hand (queue #12). */
  ruleVersion?: string;
}

export interface RoundNotary {
  notarize(input: NotarizeInput): Promise<void>;
  flush(): Promise<void>;
  stop(): void;
}

export class MerkleRoundNotary implements RoundNotary {
  private readonly aggregator: MerkleAggregator;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    chain: ChainClient,
    store: MerkleStore,
    opts: { batchSize?: number; flushIntervalMs?: number } = {},
  ) {
    this.aggregator = new MerkleAggregator(chain, store, opts.batchSize ?? 100);
    if (opts.flushIntervalMs && opts.flushIntervalMs > 0) {
      this.timer = setInterval(() => void this.flush().catch(() => {}), opts.flushIntervalMs);
      this.timer.unref?.();
    }
  }

  async notarize(input: NotarizeInput): Promise<void> {
    const roundHash = computeRoundHash({
      roundId: input.roundId,
      serverCommit: input.serverCommit,
      allClientSeeds: input.allClientSeeds,
      futureBlockHash: input.futureBlockHash,
      finalSeed: input.finalSeed,
      cards: input.cards,
      timestamp: input.timestamp,
    });
    await persistRound({
      _id: input.roundId,
      serverCommit: input.serverCommit,
      serverSeed: input.serverSeed,
      allClientSeeds: input.allClientSeeds,
      seatedClientSeeds: input.seatedClientSeeds,
      futureBlockHash: input.futureBlockHash,
      finalSeed: input.finalSeed,
      cards: input.cards,
      timestamp: input.timestamp,
      roundHash,
      ...(input.ruleVersion ? { ruleVersion: input.ruleVersion } : {}),
    });
    await this.aggregator.addRound(input.roundId, roundHash);
  }

  flush(): Promise<void> {
    return this.aggregator.flush();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
