import { awaitFutureBlockHash } from '../../src/fairness/future-block';
import type { ChainClient } from '../../src/fairness/chain';

/** A ChainClient stub; override just the two methods each test cares about. */
function chain(over: Partial<ChainClient>): ChainClient {
  return {
    getLatestBlockNumber: async () => 1000,
    getBlockHash: async (n: number) => `hash-${n}`,
    commitMerkleRoot: async () => 'tx',
    ...over,
  };
}

const noWait = { now: () => 0, sleep: async () => {} };

describe('awaitFutureBlockHash', () => {
  it('returns the hash immediately when the target block is already available', async () => {
    let calls = 0;
    const c = chain({ getBlockHash: async (n) => { calls++; return `hash-${n}`; } });
    expect(await awaitFutureBlockHash(c, 1001, noWait)).toBe('hash-1001');
    expect(calls).toBe(1); // no polling
  });

  it('polls until the future block is produced, then returns its hash', async () => {
    // The real case: getBlockHash throws for an unproduced slot, then succeeds once it finalizes.
    let calls = 0;
    const c = chain({
      getBlockHash: async (n) => {
        if (n === 1001) {
          calls++;
          if (calls < 3) throw new Error('slot not produced yet');
          return 'hash-1001';
        }
        return `hash-${n}`;
      },
    });
    expect(await awaitFutureBlockHash(c, 1001, noWait)).toBe('hash-1001');
    expect(calls).toBe(3); // polled twice, produced on the third look
  });

  it('degrades to the latest block on timeout — never stalls the deal (iron rule #2)', async () => {
    let t = 0;
    const c = chain({
      getBlockHash: async (n) => {
        if (n === 1001) throw new Error('slot never produced'); // the future block never finalizes
        return `hash-${n}`;
      },
      getLatestBlockNumber: async () => 999,
    });
    // Clock jumps 5s per read, so the 8s budget is exceeded after a couple of polls.
    const now = (): number => { const v = t; t += 5_000; return v; };
    const hash = await awaitFutureBlockHash(c, 1001, { now, sleep: async () => {}, timeoutMs: 8_000 });
    expect(hash).toBe('hash-999'); // fell back to the latest confirmed block
  });
});
