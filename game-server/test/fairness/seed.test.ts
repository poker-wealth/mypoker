import {
  generateServerCommitment,
  serverCommitOf,
  mergeClientSeeds,
  backupClientSeed,
  computeFinalSeed,
  computeRoundHash,
} from '../../src/fairness/seed';

describe('seed pipeline', () => {
  it('server commit is SHA256 of the server seed', () => {
    const { serverSeed, serverCommit } = generateServerCommitment();
    expect(serverSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(serverCommitOf(serverSeed)).toBe(serverCommit);
  });

  it('merges client seeds deterministically in seat order', () => {
    const seats = [
      { seatOrder: 1, clientSeed: 'bbbb' },
      { seatOrder: 0, clientSeed: 'aaaa' },
    ];
    // Order is by seatOrder regardless of input order.
    expect(mergeClientSeeds(seats)).toBe(mergeClientSeeds([...seats].reverse()));
    // Swapping which seed sits where changes the result.
    const swapped = [
      { seatOrder: 0, clientSeed: 'bbbb' },
      { seatOrder: 1, clientSeed: 'aaaa' },
    ];
    expect(mergeClientSeeds(seats)).not.toBe(mergeClientSeeds(swapped));
  });

  it('backup seed is deterministic from its inputs', () => {
    expect(backupClientSeed('r1', 'p1', 'nonce')).toBe(backupClientSeed('r1', 'p1', 'nonce'));
    expect(backupClientSeed('r1', 'p1', 'nonce')).not.toBe(backupClientSeed('r1', 'p2', 'nonce'));
  });

  it('final seed and round hash are deterministic and field-sensitive', () => {
    const fs1 = computeFinalSeed('srv', 'clients', 'block', 'r1');
    expect(fs1).toBe(computeFinalSeed('srv', 'clients', 'block', 'r1'));
    expect(fs1).not.toBe(computeFinalSeed('srv', 'clients', 'block', 'r2'));

    const base = {
      roundId: 'r1',
      serverCommit: 'sc',
      allClientSeeds: 'acs',
      futureBlockHash: 'fbh',
      finalSeed: fs1,
      cards: ['As', 'Kd'],
      timestamp: 1700000000000,
    };
    const h = computeRoundHash(base);
    expect(h).toBe(computeRoundHash(base));
    expect(h).not.toBe(computeRoundHash({ ...base, cards: ['As', 'Kh'] }));
  });
});
