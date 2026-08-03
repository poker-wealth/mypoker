import { RateLimiter } from '../../src/transport/rate-limiter';

describe('RateLimiter (token bucket)', () => {
  it('allows up to capacity then denies', () => {
    const now = 0;
    const rl = new RateLimiter(100, 100, () => now);
    for (let i = 0; i < 100; i++) expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(false); // 101st in the same instant
  });

  it('refills over time', () => {
    let now = 0;
    const rl = new RateLimiter(100, 100, () => now);
    for (let i = 0; i < 100; i++) rl.allow(); // drain
    expect(rl.allow()).toBe(false);
    now += 1000; // one second → full refill
    expect(rl.allow()).toBe(true);
  });

  it('refills proportionally', () => {
    let now = 0;
    const rl = new RateLimiter(100, 100, () => now);
    for (let i = 0; i < 100; i++) rl.allow();
    now += 100; // 0.1s → ~10 tokens
    let allowed = 0;
    for (let i = 0; i < 20; i++) if (rl.allow()) allowed++;
    expect(allowed).toBe(10);
  });
});
