import type { ChainClient, CommitRootArgs } from './chain';
import type { NotaryClient } from './notary';
import { ChainHealthMonitor } from './chain-health';

/**
 * ResilientChainClient — 3-layer blockchain resilience (FairPlay v6.0 §4 / §6.2).
 *
 *   L1 Solana    — primary, used while healthy.
 *   L2 Polygon   — auto-failover when Solana is unhealthy (confirm >30s or failure >5%) or errors.
 *   L3 RFC 3161  — local timestamp notary when both chains are unavailable. The game never stalls;
 *                  the batch is re-anchored on a chain once one recovers.
 *
 * `chainUsed` is reported per commit so the verification page can show the right explorer link.
 * Implements ChainClient, so it drops straight into the MerkleAggregator.
 */
export type ChainLayer = 'solana' | 'polygon' | 'rfc3161';

export interface CommitResult {
  tx: string;
  chainUsed: ChainLayer;
}

export class ResilientChainClient implements ChainClient {
  lastChainUsed: ChainLayer | null = null;

  constructor(
    private readonly solana: ChainClient,
    private readonly polygon: ChainClient,
    private readonly notary: NotaryClient,
    private readonly monitor: ChainHealthMonitor = new ChainHealthMonitor(),
  ) {}

  // Future-block randomness reads from the primary chain (deal-time degradation is handled by the
  // randomness path per v6.0 §4.1).
  getLatestBlockNumber(): Promise<number> {
    return this.solana.getLatestBlockNumber();
  }
  getBlockHash(blockNumber: number): Promise<string> {
    return this.solana.getBlockHash(blockNumber);
  }

  async commitMerkleRoot(args: CommitRootArgs): Promise<string> {
    return (await this.commitResilient(args)).tx;
  }

  /** Commit through the resilience ladder, returning which layer succeeded. */
  async commitResilient(args: CommitRootArgs): Promise<CommitResult> {
    // L1 — Solana, only while the monitor reports it healthy.
    if (this.monitor.solanaHealthy()) {
      const start = Date.now();
      try {
        const tx = await this.solana.commitMerkleRoot(args);
        this.monitor.record(true, Date.now() - start);
        return this.used('solana', tx);
      } catch {
        this.monitor.record(false, Date.now() - start);
      }
    }

    // L2 — Polygon.
    try {
      const tx = await this.polygon.commitMerkleRoot(args);
      return this.used('polygon', tx);
    } catch {
      // fall through to L3
    }

    // L3 — RFC 3161 notary (always available).
    const tx = await this.notary.timestamp(args.merkleRoot);
    return this.used('rfc3161', tx);
  }

  private used(layer: ChainLayer, tx: string): CommitResult {
    this.lastChainUsed = layer;
    return { tx, chainUsed: layer };
  }
}
