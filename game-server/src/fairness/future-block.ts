import type { ChainClient } from './chain';

/**
 * Resolve the FutureSolanaBlockHash for a round (FairPlay v6.0 §2, three-source randomness):
 *
 *   FinalSeed = SHA256(ServerSeed + AllClientSeeds + FutureSolanaBlockHash + RoundId)
 *
 * The block is chosen at commit time but its hash is unknown to everyone — platform, players, even
 * Solana validators — until that slot finalizes (v6.0 §"Why this works"). So a round targets a slot
 * that has NOT been produced yet, then waits for it. `getBlockHash` on an unproduced slot throws on a
 * real chain (the block doesn't exist); this polls until it does. The wait lands inside the deal
 * animation window (v6.0 timing table), so it is not felt.
 *
 * Iron rule #2 — a hand must never stall on the chain: on timeout this DEGRADES to the latest
 * available block and logs it, rather than hanging the deal. That block is confirmed (so it is weaker
 * "future" randomness) but the round still commits+reveals normally and can be re-anchored; a Solana
 * outage slows nobody's game.
 *
 * The deterministic FakeChainClient returns immediately, so dev/tests are unchanged.
 */

export interface FutureBlockOptions {
  /** Give up waiting for the target slot after this long, then degrade. Default 8s. */
  timeoutMs?: number;
  /** Poll interval while the slot is still unproduced. Default 400ms (~one Solana slot). */
  pollMs?: number;
  /** Injected for tests; defaults to the real clock/timer. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function awaitFutureBlockHash(
  chain: ChainClient,
  blockNumber: number,
  opts: FutureBlockOptions = {},
): Promise<string> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 400;
  const deadline = now() + (opts.timeoutMs ?? 8_000);

  for (;;) {
    try {
      const hash = await chain.getBlockHash(blockNumber);
      if (hash) return hash;
    } catch {
      // Slot not produced yet — the expected case for a future block. Fall through and retry.
    }
    if (now() >= deadline) {
      const latest = await chain.getLatestBlockNumber();
      console.warn(
        `[fairness] future block ${blockNumber} not finalized within budget; degrading to latest block ${latest}`,
      );
      return chain.getBlockHash(latest);
    }
    await sleep(pollMs);
  }
}
