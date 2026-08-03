/**
 * Token-bucket rate limiter (FairPlay M2: max 100 messages/sec per connection).
 *
 * Refills continuously at `ratePerSec`, capped at `capacity`. The clock is injectable so behaviour
 * is deterministic in tests (no real waiting).
 */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity = 100,
    private readonly ratePerSec = 100,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.last = this.now();
  }

  /** Consume one token. Returns false when the limit is exceeded. */
  allow(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.last) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.ratePerSec);
      this.last = t;
    }
  }
}
