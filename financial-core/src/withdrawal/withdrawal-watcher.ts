import { WithdrawalState } from '../domain/withdrawal-types';
import { WithdrawalModel } from './withdrawal.model';
import { confirmWithdrawal, rollbackWithdrawal, broadcastWithdrawal } from './withdrawal-state-machine';
import { tronApiUrl, tronApiKey, depositPollMs, withdrawalConfirmations } from '../config/chain';
import { alertOps } from '../lib/alert';

/**
 * Withdrawal confirmation watcher — the mirror of the deposit watcher, for the outbound leg.
 *
 * A broadcast withdrawal sits in BROADCASTING until its on-chain transaction is final. This polls
 * each pending tx and finalizes the ledger (→ CONFIRMED) once it has enough confirmations, or rolls
 * it back (releasing the player's held funds) if it reverted on-chain. confirmWithdrawal /
 * rollbackWithdrawal are idempotent on state, so re-scanning is safe.
 *
 * BUG-09 follow-up (D4b): a second scan reconciles APPROVED withdrawals carrying an unresolved
 * `pendingTxId` — a broadcast whose HTTP response was lost, so the caller never learned whether it
 * landed. Left alone that sits forever waiting for a human to notice. This checks the chain the same
 * way the first scan does and either resolves it (mined → advance to BROADCASTING, same as an
 * ordinary send) or, once the signed tx's own expiration has clearly passed, alerts ops and returns it
 * to plain APPROVED so a human can re-send.
 */

/**
 * Grace period past `pendingTxExpiration` before an unresolved send is alerted and released. Exported
 * (D8) so the reject route can give the same "cannot be declared dead yet" refusal the watcher itself
 * would honor, rather than the two drifting out of sync.
 */
export const PENDING_TX_GRACE_MS = 3 * 60 * 1000;

export interface WithdrawalTxStatus {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  confirmations: number;
  /**
   * BUG-09 follow-up (D11): the CHAIN's own current time (ms epoch, TronGrid `getnowblock`'s
   * `block_header.raw_data.timestamp`), populated only on the PENDING branch. Reconcile judges a
   * pendingTxId's expiration against THIS, never `Date.now()` — this process's clock could be wrong
   * (skewed, paused in a container, whatever) in a way that either releases a hold too early or leaves
   * one stuck forever, and the chain's own clock is the one fact both a real re-send and a real refund
   * ultimately depend on. `undefined` when the source cannot report it (never guess).
   */
  chainTimeMs?: number;
}

/** Look up one transaction's on-chain status. Injectable for tests. */
export type WithdrawalTxSource = (txHash: string) => Promise<WithdrawalTxStatus>;

/**
 * D11: a short-lived cache for the chain's own now-block timestamp, so a scan pass with many
 * unresolved broadcasts costs one extra TronGrid call rather than one per row — chain time barely
 * moves within the seconds a single pass takes.
 */
let chainTimeCache: { atMs: number; chainTimeMs: number } | undefined;
const CHAIN_TIME_CACHE_TTL_MS = 5_000;

async function nowBlockTimeMs(
  base: string,
  headers: Record<string, string>,
): Promise<number | undefined> {
  if (chainTimeCache && Date.now() - chainTimeCache.atMs < CHAIN_TIME_CACHE_TTL_MS) {
    return chainTimeCache.chainTimeMs;
  }
  const res = await fetch(`${base}/wallet/getnowblock`, { method: 'POST', headers, body: '{}' });
  const body = (await res.json()) as { block_header?: { raw_data?: { timestamp?: number } } };
  const ts = body.block_header?.raw_data?.timestamp;
  if (typeof ts !== 'number') return undefined;
  chainTimeCache = { atMs: Date.now(), chainTimeMs: ts };
  return ts;
}

/** Live source: TronGrid transaction info + current block height for the confirmation depth. */
export const tronGridWithdrawalSource: WithdrawalTxSource = async (txHash) => {
  const base = tronApiUrl();
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  const key = tronApiKey();
  if (key) headers['TRON-PRO-API-KEY'] = key;

  const infoRes = await fetch(`${base}/wallet/gettransactioninfobyid`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ value: txHash }),
  });
  if (!infoRes.ok) throw new Error(`TronGrid ${infoRes.status} for tx ${txHash}`);
  const info = (await infoRes.json()) as { blockNumber?: number; receipt?: { result?: string } };
  if (!info.blockNumber) {
    // D11: chainTimeMs only matters to the caller once a tx is still unmined — fetch it here, not on
    // the mined branch below, which has never needed it and shouldn't grow a new dependency to get it.
    const chainTimeMs = await nowBlockTimeMs(base, headers).catch(() => undefined);
    return { status: 'PENDING', confirmations: 0, ...(chainTimeMs !== undefined ? { chainTimeMs } : {}) };
  }

  // A successful contract call reports receipt.result === 'SUCCESS'; a revert reports REVERT /
  // OUT_OF_ENERGY / etc. Our USDT transfer always sets it, so a mined-but-not-SUCCESS tx failed.
  const result = info.receipt?.result;
  const status: WithdrawalTxStatus['status'] = result && result !== 'SUCCESS' ? 'FAILED' : 'SUCCESS';

  const nowRes = await fetch(`${base}/wallet/getnowblock`, { method: 'POST', headers, body: '{}' });
  const now = (await nowRes.json()) as { block_header?: { raw_data?: { number?: number } } };
  const nowBlock = now.block_header?.raw_data?.number ?? info.blockNumber;
  return { status, confirmations: Math.max(0, nowBlock - info.blockNumber) };
};

/** One pass over every BROADCASTING withdrawal. Idempotent — safe to call repeatedly. */
export async function checkWithdrawalsOnce(
  source: WithdrawalTxSource = tronGridWithdrawalSource,
): Promise<{ checked: number; confirmed: number; failed: number }> {
  const pending = await WithdrawalModel.find({ state: WithdrawalState.BROADCASTING }).lean();
  let confirmed = 0;
  let failed = 0;

  for (const w of pending) {
    if (!w.txHash) continue;
    let st: WithdrawalTxStatus;
    try {
      st = await source(w.txHash);
    } catch (err) {
      console.error(`[withdrawal-watcher] source failed for ${w._id}:`, (err as Error).message);
      continue;
    }

    if (st.status === 'FAILED') {
      await rollbackWithdrawal(w._id, `on-chain failure: ${w.txHash}`);
      failed++;
      console.log(`[withdrawal-watcher] rolled back ${w._id} (on-chain failure ${w.txHash})`);
    } else if (st.status === 'SUCCESS' && st.confirmations >= withdrawalConfirmations()) {
      await confirmWithdrawal(w._id);
      confirmed++;
      console.log(`[withdrawal-watcher] confirmed ${w._id} (${w.txHash})`);
    }
  }

  await reconcilePendingBroadcasts(source);

  return { checked: pending.length, confirmed, failed };
}

/**
 * BUG-09 follow-up (D4b): resolve APPROVED withdrawals whose broadcast never reported back.
 *
 * Idempotent, like the rest of this file — safe to re-run every poll. Every branch below either
 * changes nothing (still ambiguous, still within the grace period) or moves the withdrawal somewhere
 * that the ordinary machinery (this scan's first loop, or a human) takes it from next.
 */
async function reconcilePendingBroadcasts(source: WithdrawalTxSource): Promise<void> {
  const unresolved = await WithdrawalModel.find({
    state: WithdrawalState.APPROVED,
    pendingTxId: { $exists: true },
  }).lean();

  for (const w of unresolved) {
    if (!w.pendingTxId) continue;
    // D12: one row's failure — including the CAS race handled in the mined branch below — must not
    // stop the rest of this pass from being reconciled. Mirrors the ordinary BROADCASTING scan above,
    // which is resilient the same way against a bad `source()` call; this extends that to the actions
    // taken after a successful one too, since this loop (unlike that one) can hit a state that moved
    // out from under it.
    try {
      let st: WithdrawalTxStatus;
      try {
        st = await source(w.pendingTxId);
      } catch (err) {
        console.error(
          `[withdrawal-watcher] pending-tx source failed for ${w._id}:`,
          (err as Error).message,
        );
        continue;
      }

      if (st.status === 'SUCCESS' || st.status === 'FAILED') {
        // Mined either way — the ambiguity is over. Record the real txHash and let the ordinary
        // BROADCASTING scan above finish (SUCCESS) or roll it back (FAILED) on the next pass, exactly
        // as it would for a send that reported back normally.
        try {
          await broadcastWithdrawal(w._id, w.pendingTxId);
          console.log(
            `[withdrawal-watcher] resolved pending send ${w._id} (${w.pendingTxId}, on-chain ${st.status})`,
          );
        } catch (err) {
          // D12: the row moved under us since it was read into `unresolved` above — most plausibly an
          // admin's chainChecked reject won a race against THIS tx actually mining. If that's what
          // happened, the withdrawal is now refunded AND the transfer landed: a double-pay, and it
          // needs a human right now, not a log line indistinguishable from any other transient failure.
          const reloaded = await WithdrawalModel.findById(w._id).lean();
          if (reloaded?.state === WithdrawalState.ROLLED_BACK) {
            await alertOps('withdrawal refunded but its pending tx MINED — DOUBLE PAY, investigate', {
              withdrawalId: w._id,
              txId: w.pendingTxId,
              onChainStatus: st.status,
            });
          } else {
            console.error(
              `[withdrawal-watcher] failed to record resolved pending send ${w._id}:`,
              (err as Error).message,
            );
          }
        }
        continue;
      }

      // Still not mined. Not yet safe to touch unless the signed tx's own expiration has clearly passed
      // — while it's still live, TronGrid could mine it at any moment.
      if (!w.pendingTxExpiration) {
        // Legacy row (pendingTxId set before pendingTxExpiration existed, or the build response never
        // carried one) — no expiry to compare against. Alert only; never guess an unresolved send is
        // safe to release without one.
        await alertOps('withdrawal has an unresolved broadcast with no recorded expiration — manual check', {
          withdrawalId: w._id,
          txId: w.pendingTxId,
        });
        continue;
      }

      // D11: judged against the CHAIN's own clock (chainTimeMs), never this process's Date.now() — see
      // WithdrawalTxStatus.chainTimeMs. No chain time back from the source → alert and wait for a pass
      // that has one; never fall back to guessing off the local clock.
      if (st.chainTimeMs === undefined) {
        await alertOps(
          'withdrawal has an unresolved broadcast but chain time is unavailable — cannot judge expiry, manual check',
          { withdrawalId: w._id, txId: w.pendingTxId },
        );
        continue;
      }
      if (st.chainTimeMs <= w.pendingTxExpiration.getTime() + PENDING_TX_GRACE_MS) continue;

      // Expired well past its window (by chain time) and still not on-chain — safe to conclude it never
      // landed. Alert (this is still a human decision to re-send) and clear pendingTxId/pendingTxExpiration
      // so the withdrawal returns to plain APPROVED, guarded by the same pendingTxId so a send that lands
      // in the instant between the check above and this write is not silently discarded.
      const cleared = await WithdrawalModel.updateOne(
        { _id: w._id, pendingTxId: w.pendingTxId },
        { $unset: { pendingTxId: '', pendingTxExpiration: '' } },
      );
      if (cleared.modifiedCount === 1) {
        await alertOps('withdrawal broadcast expired unmined — returned to APPROVED for re-send', {
          withdrawalId: w._id,
          txId: w.pendingTxId,
        });
        console.log(`[withdrawal-watcher] cleared expired pending send ${w._id} (${w.pendingTxId})`);
      }
    } catch (err) {
      console.error(`[withdrawal-watcher] reconcile failed for ${w._id}:`, (err as Error).message);
    }
  }
}

/** Poll forever on the configured interval. Returns a stop handle. */
export function runWithdrawalWatcher(pollMs: number = depositPollMs()): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await checkWithdrawalsOnce();
    } catch (err) {
      console.error('[withdrawal-watcher] poll failed:', (err as Error).message);
    }
    if (!stopped) timer = setTimeout(() => void tick(), pollMs);
  };

  void tick();
  return {
    stop: (): void => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
