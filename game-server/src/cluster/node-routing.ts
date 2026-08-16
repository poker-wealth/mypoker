/**
 * Region routing for the three-node topology (plan Day 13): Singapore (primary/write), Tokyo (read),
 * Hong Kong (read). This is the pure decision policy — `getBestNode` — that the gateway calls to pick
 * where a client's request goes. Standing up the actual nodes + Redis Sentinel + WAL is the infra
 * half; this is the routing contract that half plugs into, kept pure so it is testable without a
 * cluster.
 *
 * Two rules the spec cares about, enforced here so they cannot be got wrong at a call site:
 *   - WRITES go only to the healthy PRIMARY. A read replica must never take a write (it would diverge
 *     from the WAL). If the primary is down, this returns null — the caller must wait for Sentinel to
 *     promote a new primary rather than write somewhere unsafe.
 *   - READS prefer the closest healthy node by geographic proximity, so a Tokyo player is served from
 *     Tokyo, falling back outward, and finally to the primary. Reads may be served by the primary but
 *     are kept off it when a nearer replica is healthy, to spare the write node.
 */

export type Region = 'SG' | 'TOKYO' | 'HK';
export type NodeRole = 'primary' | 'read';

export interface ClusterNode {
  id: string;
  region: Region;
  role: NodeRole;
  healthy: boolean;
}

/** For a client in region R, the preference order of node regions (closest first). */
const PROXIMITY: Readonly<Record<Region, readonly Region[]>> = {
  SG: ['SG', 'HK', 'TOKYO'],
  TOKYO: ['TOKYO', 'HK', 'SG'],
  HK: ['HK', 'TOKYO', 'SG'],
};

export interface RouteOptions {
  /** A write (settlement, buy-in, withdrawal) — must land on the primary. Default false (a read). */
  write?: boolean;
}

/**
 * Pick the node a client in `clientRegion` should talk to, or null if none can serve the request.
 * Writes → the healthy primary (or null). Reads → the closest healthy node by proximity, replica
 * preferred over the primary, primary as the last resort.
 */
export function getBestNode(
  clientRegion: Region,
  nodes: readonly ClusterNode[],
  opts: RouteOptions = {},
): ClusterNode | null {
  const healthy = nodes.filter((n) => n.healthy);
  if (healthy.length === 0) return null;

  // Writes are primary-only; never silently downgrade to a replica.
  if (opts.write) return healthy.find((n) => n.role === 'primary') ?? null;

  // Reads: walk outward by proximity, preferring a read replica in each region before the primary.
  for (const region of PROXIMITY[clientRegion]) {
    const inRegion = healthy.filter((n) => n.region === region);
    const choice = inRegion.find((n) => n.role === 'read') ?? inRegion.find((n) => n.role === 'primary');
    if (choice) return choice;
  }
  // Nothing matched by region (unknown regions / partial cluster) — any healthy node, primary last.
  return healthy.find((n) => n.role === 'read') ?? healthy.find((n) => n.role === 'primary') ?? null;
}
