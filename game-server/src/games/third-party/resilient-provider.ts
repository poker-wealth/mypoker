import type { RoundRequest, SignedRoundResult, ThirdPartyProvider } from './adapter';

/**
 * ResilientProvider — a circuit breaker around an outside vendor.
 *
 * Spec blocker (W5→W6): "Third-party API integration leaks errors into FC → strict isolation must be
 * enforced before W6." A vendor outage must degrade to "temporarily unavailable" and nothing more:
 *
 *   • A hang cannot stall a table       — every call is bounded by a timeout.
 *   • A vendor failure cannot reach money — it throws ProviderUnavailableError BEFORE the adapter
 *     reaches the Financial Core, so a broken vendor produces zero FC transactions, not failed ones.
 *   • A dead vendor cannot be hammered   — after `failureThreshold` consecutive failures the breaker
 *     opens and fails fast without calling out at all, then probes once after `cooldownMs`.
 *   • One vendor cannot take down another — each has its own breaker; Lottery dying leaves Slots
 *     (and all seven of our own games) untouched.
 */

export class ProviderUnavailableError extends Error {
  readonly provider: string;
  constructor(provider: string, reason: string) {
    super(`${provider} is temporarily unavailable: ${reason}`);
    this.name = 'ProviderUnavailableError';
    this.provider = provider;
  }
}

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ResilientProviderOptions {
  timeoutMs: number;
  /** Consecutive failures before the breaker opens. */
  failureThreshold: number;
  /** How long the breaker stays open before probing the vendor again. */
  cooldownMs: number;
  /** Injectable clock, so cooldown is testable without waiting. */
  now?: () => number;
}

export class ResilientProvider implements ThirdPartyProvider {
  readonly name: string;
  private readonly inner: ThirdPartyProvider;
  private readonly opts: Required<ResilientProviderOptions>;
  private failures = 0;
  private openedAt = 0;
  private state: BreakerState = 'CLOSED';

  constructor(inner: ThirdPartyProvider, opts: ResilientProviderOptions) {
    this.inner = inner;
    this.name = inner.name;
    this.opts = { now: (): number => Date.now(), ...opts };
  }

  getState(): BreakerState {
    this.refresh();
    return this.state;
  }

  /** What the lobby shows the player: an unavailable game is greyed out, not broken. */
  isAvailable(): boolean {
    return this.getState() !== 'OPEN';
  }

  /** Move OPEN → HALF_OPEN once the cooldown has elapsed. */
  private refresh(): void {
    if (this.state === 'OPEN' && this.opts.now() - this.openedAt >= this.opts.cooldownMs) {
      this.state = 'HALF_OPEN';
    }
  }

  async playRound(req: RoundRequest): Promise<SignedRoundResult> {
    this.refresh();
    if (this.state === 'OPEN') {
      // Fail fast — we do not even call a vendor we know is down.
      throw new ProviderUnavailableError(this.name, 'circuit open');
    }

    try {
      const result = await this.withTimeout(this.inner.playRound(req));
      this.failures = 0;
      this.state = 'CLOSED';
      return result;
    } catch (err) {
      this.failures += 1;
      if (this.state === 'HALF_OPEN' || this.failures >= this.opts.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = this.opts.now();
      }
      // Normalise ANY vendor fault into one typed, expected error. The adapter has not touched the
      // Financial Core at this point, so no money moved and no FC error was ever raised.
      throw new ProviderUnavailableError(this.name, err instanceof Error ? err.message : 'failed');
    }
  }

  private async withTimeout(p: Promise<SignedRoundResult>): Promise<SignedRoundResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), this.opts.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
