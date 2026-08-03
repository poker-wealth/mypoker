import { createHash } from 'node:crypto';
import { MerkleTree } from '../../src/fairness/merkle';

const leaf = (s: string): string => createHash('sha256').update(s).digest('hex');

describe('MerkleTree', () => {
  it('verifies a proof for every leaf against the root', () => {
    const leaves = Array.from({ length: 7 }, (_, i) => leaf(`round-${i}`));
    const tree = new MerkleTree(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.getProof(i);
      expect(MerkleTree.verify(leaves[i]!, proof, tree.root)).toBe(true);
    }
  });

  it('rejects a proof for a tampered leaf', () => {
    const leaves = [leaf('a'), leaf('b'), leaf('c'), leaf('d')];
    const tree = new MerkleTree(leaves);
    const proof = tree.getProof(2);
    expect(MerkleTree.verify(leaf('TAMPERED'), proof, tree.root)).toBe(false);
  });

  it('changing any leaf changes the root', () => {
    const a = new MerkleTree([leaf('x'), leaf('y'), leaf('z')]).root;
    const b = new MerkleTree([leaf('x'), leaf('Y'), leaf('z')]).root;
    expect(a).not.toBe(b);
  });

  it('handles a single leaf', () => {
    const tree = new MerkleTree([leaf('solo')]);
    expect(tree.root).toBe(leaf('solo'));
    expect(MerkleTree.verify(leaf('solo'), tree.getProof(0), tree.root)).toBe(true);
  });
});
