import { getBestNode, type ClusterNode } from '../../src/cluster/node-routing';

/** The Day-13 topology: SG primary/write, Tokyo + HK read replicas. */
const CLUSTER: ClusterNode[] = [
  { id: 'sg', region: 'SG', role: 'primary', healthy: true },
  { id: 'tokyo', region: 'TOKYO', role: 'read', healthy: true },
  { id: 'hk', region: 'HK', role: 'read', healthy: true },
];

const withHealth = (id: string, healthy: boolean): ClusterNode[] =>
  CLUSTER.map((n) => (n.id === id ? { ...n, healthy } : { ...n }));

describe('getBestNode — three-node region routing', () => {
  it('routes every write to the primary, whatever the client region', () => {
    for (const region of ['SG', 'TOKYO', 'HK'] as const) {
      expect(getBestNode(region, CLUSTER, { write: true })?.id).toBe('sg');
    }
  });

  it('serves a read from the client’s own region when healthy', () => {
    expect(getBestNode('TOKYO', CLUSTER)?.id).toBe('tokyo');
    expect(getBestNode('HK', CLUSTER)?.id).toBe('hk');
    expect(getBestNode('SG', CLUSTER)?.id).toBe('sg'); // primary also serves its local reads
  });

  it('falls back to the next-closest healthy node when the local replica is down', () => {
    // Tokyo down → a Tokyo client goes to HK (its next-closest), not all the way to SG.
    expect(getBestNode('TOKYO', withHealth('tokyo', false))?.id).toBe('hk');
  });

  it('prefers a read replica over the primary for reads when one is available', () => {
    // An HK client reads from HK, never burdening the SG write node.
    expect(getBestNode('HK', CLUSTER)?.role).toBe('read');
  });

  it('returns null for a write when the primary is unhealthy (await Sentinel promotion)', () => {
    // A read replica must NEVER absorb a write — better to fail and wait for a new primary.
    expect(getBestNode('SG', withHealth('sg', false), { write: true })).toBeNull();
  });

  it('still serves reads when the primary is down, from the healthy replicas', () => {
    const noPrimary = withHealth('sg', false);
    expect(getBestNode('SG', noPrimary)?.id).toBe('hk'); // SG proximity: SG(down)→HK→TOKYO
    expect(getBestNode('TOKYO', noPrimary)?.id).toBe('tokyo');
  });

  it('returns null when the whole cluster is unhealthy', () => {
    const allDown = CLUSTER.map((n) => ({ ...n, healthy: false }));
    expect(getBestNode('SG', allDown)).toBeNull();
    expect(getBestNode('SG', allDown, { write: true })).toBeNull();
  });
});
