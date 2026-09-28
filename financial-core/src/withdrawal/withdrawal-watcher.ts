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

/** Grace period past `pendingTxExpiration` before an unresolved send is alerted and released. */
const PENDING_TX_GRACE_MS = 3 * 60 * 1000;

export interface WithdrawalTxStatus {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  confirmations: number;
}

/** Look up one transaction's on-chain status. Injectable for tests. */
export type WithdrawalTxSource = (txHash: string) => Promise<WithdrawalTxStatus>;

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
  if (!info.blockNumber) return { status: 'PENDING', confirmations: 0 }; // not mined yet

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
      // BROADCASTING scan above finish (SUCCESS) or roll it back (FAILED) on the next pass, exactly as
      // it would for a send that reported back normally.
      await broadcastWithdrawal(w._id, w.pendingTxId);
      console.log(
        `[withdrawal-watcher] resolved pending send ${w._id} (${w.pendingTxId}, on-chain ${st.status})`,
      );
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
    if (Date.now() - w.pendingTxExpiration.getTime() <= PENDING_TX_GRACE_MS) continue;

    // Expired well past its window and still not on-chain — safe to conclude it never landed. Alert
    // (this is still a human decision to re-send) and clear pendingTxId/pendingTxExpiration so the
    // withdrawal returns to plain APPROVED, guarded by the same pendingTxId so a send that lands in the
    // instant between the check above and this write is not silently discarded.
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
