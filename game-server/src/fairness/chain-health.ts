/**
 * ChainHealthMonitor (FairPlay v6.0 §4 / §6.2). Tracks recent Solana commit outcomes and decides
 * whether the primary chain is healthy. Unhealthy when, over a sliding window, the failure rate
 * exceeds 5% OR the most recent confirm time exceeds 30s — at which point traffic fails over to
 * Polygon (L2).
 */
export interface ChainHealthOptions {
  maxConfirmMs?: number;
  maxFailureRate?: number;
  windowSize?: number;
}

interface Sample {
  success: boolean;
  confirmMs: number;
}

export class ChainHealthMonitor {
  private readonly samples: Sample[] = [];
  private readonly maxConfirmMs: number;
  private readonly maxFailureRate: number;
  private readonly windowSize: number;

  constructor(opts: ChainHealthOptions = {}) {
    this.maxConfirmMs = opts.maxConfirmMs ?? 30_000;
    this.maxFailureRate = opts.maxFailureRate ?? 0.05;
    this.windowSize = opts.windowSize ?? 20;
  }

  record(success: boolean, confirmMs = 0): void {
    this.samples.push({ success, confirmMs });
    if (this.samples.length > this.windowSize) this.samples.shift();
  }

  /** Healthy until proven otherwise; trips on failure-rate or slow-confirm thresholds. */
  solanaHealthy(): boolean {
    if (this.samples.length === 0) return true;
    const failures = this.samples.filter((s) => !s.success).length;
    const failureRate = failures / this.samples.length;
    if (failureRate > this.maxFailureRate) return false;
    const last = this.samples[this.samples.length - 1]!;
    if (last.success && last.confirmMs > this.maxConfirmMs) return false;
    return true;
  }
}
