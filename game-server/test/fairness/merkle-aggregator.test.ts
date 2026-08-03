import { createHash } from 'node:crypto';
import { MerkleAggregator, InMemoryMerkleStore } from '../../src/fairness/merkle-aggregator';
import { MerkleTree } from '../../src/fairness/merkle';
import { FakeChainClient } from '../../src/fairness/chain';

const rhash = (s: string): string => createHash('sha256').update(s).digest('hex');

describe('MerkleAggregator', () => {
  it('commits a batch once it reaches batchSize and stores verifiable proofs', async () => {
    const chain = new FakeChainClient();
    const store = new InMemoryMerkleStore();
    const agg = new MerkleAggregator(chain, store, 3); // small batch for the test

    await agg.addRound('r1', rhash('r1'));
    await agg.addRound('r2', rhash('r2'));
    expect(chain.commits).toHaveLength(0); // not full yet
    expect(agg.pending).toBe(2);

    await agg.addRound('r3', rhash('r3')); // now full → commits
    expect(chain.commits).toHaveLength(1);
    expect(chain.commits[0]!.roundCount).toBe(3);
    expect(agg.pending).toBe(0);

    // Every round in the batch has a proof that rebuilds the committed root.
    for (const id of ['r1', 'r2', 'r3']) {
      const rec = store.get(id)!;
      expect(rec.chainTx).toMatch(/^fake-tx-/);
      expect(rec.merkleRoot).toBe(chain.commits[0]!.merkleRoot);
      expect(MerkleTree.verify(rec.roundHash, rec.merkleProof, rec.merkleRoot)).toBe(true);
    }
  });

  it('flush() commits a partial batch (off-peak window)', async () => {
    const chain = new FakeChainClient();
    const store = new InMemoryMerkleStore();
    const agg = new MerkleAggregator(chain, store, 100);

    await agg.addRound('r1', rhash('r1'));
    expect(chain.commits).toHaveLength(0);
    await agg.flush();
    expect(chain.commits).toHaveLength(1);
    expect(store.get('r1')!.chainTx).toBeTruthy();
  });
});
