import { computeRoundHash } from '../../src/fairness/seed';

const persisted: Record<string, unknown>[] = [];
jest.mock('../../src/fairness/round-store', () => ({
  persistRound: (doc: Record<string, unknown>) => {
    persisted.push(doc);
    return Promise.resolve();
  },
  MongoMerkleStore: class {
    save(): void {}
    get(): undefined {
      return undefined;
    }
  },
}));

// Imported after the mock so the notary picks up the stub.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MerkleRoundNotary } = require('../../src/fairness/round-notary') as typeof import('../../src/fairness/round-notary');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FakeChainClient } = require('../../src/fairness/chain') as typeof import('../../src/fairness/chain');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { InMemoryMerkleStore } = require('../../src/fairness/merkle-aggregator') as typeof import('../../src/fairness/merkle-aggregator');

/**
 * The rule-version stamp reaches the round record — and the round HASH does not
 * move (queue #12).
 *
 * The second half matters more than the first. `computeRoundHash` is the v6.0
 * verifier's contract: it is what a player re-derives in step 5, and what the
 * Merkle leaf commits to. Folding the rule version into it would be the
 * cryptographically stronger design and would also stop every already-notarized
 * round from verifying — a silent, retroactive break of the one guarantee this
 * whole subsystem exists to provide.
 *
 * So the version rides ALONGSIDE the round. This test pins that decision: if
 * someone later adds it to the hash inputs, the second case fails and forces the
 * conversation about migrating existing rounds.
 */

const input = {
  roundId: 'r-1',
  serverCommit: 'commit',
  serverSeed: 'seed',
  allClientSeeds: 'a|b',
  seatedClientSeeds: [{ seatOrder: 0, clientSeed: 'a' }],
  futureBlockHash: 'blockhash',
  finalSeed: 'final',
  cards: ['As', 'Kd'],
  timestamp: 1_700_000_000_000,
};

describe('rule-version stamp on a notarized round', () => {
  beforeEach(() => {
    persisted.length = 0;
  });

  it('records the version the hand ran under', async () => {
    const notary = new MerkleRoundNotary(new FakeChainClient(), new InMemoryMerkleStore());
    await notary.notarize({ ...input, ruleVersion: 'abc123' });
    notary.stop();

    expect(persisted).toHaveLength(1);
    expect(persisted[0]!['ruleVersion']).toBe('abc123');
  });

  it('leaves the round hash byte-identical — the verifier contract is untouched', async () => {
    const notary = new MerkleRoundNotary(new FakeChainClient(), new InMemoryMerkleStore());
    await notary.notarize({ ...input, ruleVersion: 'abc123' });
    notary.stop();

    // The hash a verifier computes from the PUBLISHED inputs, with no knowledge
    // that a rule version exists at all.
    const expected = computeRoundHash({
      roundId: input.roundId,
      serverCommit: input.serverCommit,
      allClientSeeds: input.allClientSeeds,
      futureBlockHash: input.futureBlockHash,
      finalSeed: input.finalSeed,
      cards: input.cards,
      timestamp: input.timestamp,
    });
    expect(persisted[0]!['roundHash']).toBe(expected);
  });

  it('omits the field entirely when no version is supplied', async () => {
    // A round notarized before this existed has no version, and inventing one
    // would be a stamp that vouches for rules nobody checked.
    const notary = new MerkleRoundNotary(new FakeChainClient(), new InMemoryMerkleStore());
    await notary.notarize(input);
    notary.stop();

    expect(persisted[0]!['ruleVersion']).toBeUndefined();
  });
});
