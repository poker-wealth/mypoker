import { createHash } from 'node:crypto';

/**
 * Merkle tree over round hashes (FairPlay v5.9.1 / v6.0, verification step 6).
 *
 * Rounds are batch-notarized: only the Merkle ROOT goes on-chain, but every round keeps a proof so
 * it stays independently verifiable. Deleting or altering any round changes its leaf → changes the
 * root → mismatches the on-chain record → exposed.
 */

function hashPair(a: string, b: string): string {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(a, 'hex'), Buffer.from(b, 'hex')]))
    .digest('hex');
}

export interface ProofNode {
  hash: string;
  /** true if the sibling is on the right of the current node. */
  right: boolean;
}

export class MerkleTree {
  /** layers[0] = leaves, last layer = [root]. */
  private readonly layers: string[][];

  constructor(leaves: readonly string[]) {
    if (leaves.length === 0) throw new Error('MerkleTree requires at least one leaf');
    this.layers = [ [...leaves] ];
    let level = this.layers[0]!;
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i]!;
        const right = level[i + 1] ?? left; // duplicate the last node if odd
        next.push(hashPair(left, right));
      }
      this.layers.push(next);
      level = next;
    }
  }

  get root(): string {
    return this.layers[this.layers.length - 1]![0]!;
  }

  /** Sibling path from a leaf index up to the root. */
  getProof(leafIndex: number): ProofNode[] {
    if (leafIndex < 0 || leafIndex >= this.layers[0]!.length) {
      throw new RangeError('leafIndex out of range');
    }
    const proof: ProofNode[] = [];
    let index = leafIndex;
    for (let level = 0; level < this.layers.length - 1; level++) {
      const nodes = this.layers[level]!;
      const isRightNode = index % 2 === 1;
      const siblingIndex = isRightNode ? index - 1 : index + 1;
      const sibling = nodes[siblingIndex] ?? nodes[index]!; // duplicated last node
      proof.push({ hash: sibling, right: !isRightNode });
      index = Math.floor(index / 2);
    }
    return proof;
  }

  /** Reconstruct the root from a leaf + its proof and compare. */
  static verify(leaf: string, proof: readonly ProofNode[], root: string): boolean {
    let computed = leaf;
    for (const node of proof) {
      computed = node.right ? hashPair(computed, node.hash) : hashPair(node.hash, computed);
    }
    return computed === root;
  }
}
