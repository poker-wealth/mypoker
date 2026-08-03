import { ResilientChainClient } from '../../src/fairness/resilient-chain';
import { ChainHealthMonitor } from '../../src/fairness/chain-health';
import { FakeNotary } from '../../src/fairness/notary';
import type { ChainClient, CommitRootArgs } from '../../src/fairness/chain';

const ARGS: CommitRootArgs = {
  merkleRoot: 'a'.repeat(64),
  roundCount: 100,
  fromRoundId: 'r1',
  toRoundId: 'r100',
};

/** A chain whose commit either resolves to a fixed tx or throws. */
function chain(tx: string, opts: { fail?: boolean } = {}): ChainClient & { calls: number } {
  return {
    calls: 0,
    async getLatestBlockNumber() {
      return 1;
    },
    async getBlockHash() {
      return 'h';
    },
    async commitMerkleRoot() {
      this.calls += 1;
      if (opts.fail) throw new Error('chain down');
      return tx;
    },
  };
}

describe('ResilientChainClient — 3-layer failover', () => {
  it('L1: uses Solana when healthy', async () => {
    const solana = chain('sol-tx');
    const r = new ResilientChainClient(solana, chain('poly-tx'), new FakeNotary());
    const res = await r.commitResilient(ARGS);
    expect(res).toEqual({ tx: 'sol-tx', chainUsed: 'solana' });
  });

  it('L2: fails over to Polygon when Solana errors', async () => {
    const solana = chain('sol-tx', { fail: true });
    const polygon = chain('poly-tx');
    const r = new ResilientChainClient(solana, polygon, new FakeNotary());
    const res = await r.commitResilient(ARGS);
    expect(res).toEqual({ tx: 'poly-tx', chainUsed: 'polygon' });
    expect(solana.calls).toBe(1); // it tried Solana first
  });

  it('L3: falls back to the RFC-3161 notary when both chains are down', async () => {
    const notary = new FakeNotary();
    const r = new ResilientChainClient(
      chain('sol', { fail: true }),
      chain('poly', { fail: true }),
      notary,
    );
    const res = await r.commitResilient(ARGS);
    expect(res.chainUsed).toBe('rfc3161');
    expect(res.tx).toMatch(/^rfc3161-/);
    expect(notary.stamped).toContain(ARGS.merkleRoot);
  });

  it('skips Solana entirely when the health monitor reports it unhealthy', async () => {
    const monitor = new ChainHealthMonitor({ maxFailureRate: 0.05, windowSize: 10 });
    for (let i = 0; i < 5; i++) monitor.record(false); // drive failure rate up
    expect(monitor.solanaHealthy()).toBe(false);

    const solana = chain('sol-tx'); // would succeed, but should not be called
    const polygon = chain('poly-tx');
    const r = new ResilientChainClient(solana, polygon, new FakeNotary(), monitor);
    const res = await r.commitResilient(ARGS);
    expect(res.chainUsed).toBe('polygon');
    expect(solana.calls).toBe(0); // bypassed
  });

  it('reports the last chain used and satisfies the ChainClient interface', async () => {
    const r = new ResilientChainClient(chain('sol-tx'), chain('poly'), new FakeNotary());
    const tx = await r.commitMerkleRoot(ARGS); // interface method
    expect(tx).toBe('sol-tx');
    expect(r.lastChainUsed).toBe('solana');
  });
});

describe('ChainHealthMonitor', () => {
  it('is healthy with no samples and trips on failure rate', () => {
    const m = new ChainHealthMonitor({ maxFailureRate: 0.05, windowSize: 10 });
    expect(m.solanaHealthy()).toBe(true);
    for (let i = 0; i < 9; i++) m.record(true, 100);
    m.record(false);
    expect(m.solanaHealthy()).toBe(false); // 1/10 = 10% > 5%
  });

  it('trips when the latest confirm time exceeds 30s', () => {
    const m = new ChainHealthMonitor({ maxConfirmMs: 30_000 });
    m.record(true, 35_000);
    expect(m.solanaHealthy()).toBe(false);
  });
});
