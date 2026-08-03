import { createHash } from 'node:crypto';

/**
 * Deterministic, reproducible card shuffle from a seed (FairPlay v6.0, verification step 4).
 *
 * The final_seed drives a counter-based hash stream (SHA256(seed:block)) of uint32s; Fisher-Yates
 * consumes them with rejection sampling (no modulo bias). Identical seed → identical deck, every
 * time, on any machine — which is exactly what lets a player re-derive and verify the deal.
 */

class SeededRng {
  private blockIndex = 0;
  private pool: Buffer = Buffer.alloc(0);
  private offset = 0;

  constructor(private readonly seed: string) {}

  private refill(): void {
    this.pool = createHash('sha256').update(`${this.seed}:${this.blockIndex}`).digest();
    this.blockIndex += 1;
    this.offset = 0;
  }

  private nextUint32(): number {
    if (this.offset + 4 > this.pool.length) this.refill();
    const v = this.pool.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  /** Uniform integer in [0, n) via rejection sampling — no modulo bias. */
  nextIntBelow(n: number): number {
    if (n <= 0) throw new RangeError('n must be > 0');
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    let x = this.nextUint32();
    while (x >= limit) x = this.nextUint32();
    return x % n;
  }
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['c', 'd', 'h', 's'] as const;

/** The 52-card deck in canonical pre-shuffle order (e.g. '2c', '2d', …, 'As'). */
export function standardDeck(): string[] {
  const deck: string[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) deck.push(`${rank}${suit}`);
  }
  return deck;
}

/** Fisher-Yates shuffle of `deck` driven deterministically by `seed`. Returns a new array. */
export function shuffle(deck: readonly string[], seed: string): string[] {
  const out = [...deck];
  const rng = new SeededRng(seed);
  for (let i = out.length - 1; i >= 1; i--) {
    const j = rng.nextIntBelow(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Shuffle a fresh standard 52-card deck from a seed. */
export function shuffledDeck(seed: string): string[] {
  return shuffle(standardDeck(), seed);
}
