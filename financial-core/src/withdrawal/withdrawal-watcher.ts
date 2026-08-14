import { WithdrawalState } from '../domain/withdrawal-types';
import { WithdrawalModel } from './withdrawal.model';
import { confirmWithdrawal, rollbackWithdrawal } from './withdrawal-state-machine';
import { tronApiUrl, tronApiKey, depositPollMs, withdrawalConfirmations } from '../config/chain';

/**
 * Withdrawal confirmation watcher — the mirror of the deposit watcher, for the outbound leg.
 *
 * A broadcast withdrawal sits in BROADCASTING until its on-chain transaction is final. This polls
 * each pending tx and finalizes the ledger (→ CONFIRMED) once it has enough confirmations, or rolls
 * it back (releasing the player's held funds) if it reverted on-chain. confirmWithdrawal /
 * rollbackWithdrawal are idempotent on state, so re-scanning is safe.
 */

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

  return { checked: pending.length, confirmed, failed };
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
