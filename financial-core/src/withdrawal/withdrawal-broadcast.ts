import { Money } from '../domain/money';
import { WithdrawalState } from '../domain/withdrawal-types';
import { WithdrawalNotFoundError } from '../wallet/errors';
import { WithdrawalModel } from './withdrawal.model';
import { broadcastWithdrawal, rollbackWithdrawal } from './withdrawal-state-machine';
import { buildAndSignTransfer, broadcastSigned, usdtToUnits, type SignerConfig } from './tron-signer';
import { signerFromEnv } from './signer-from-env';
import { tronApiUrl, tronApiKey, usdtContract, withdrawalFeeLimitSun } from '../config/chain';
import { alertOps } from '../lib/alert';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The on-chain leg of a withdrawal: turn an APPROVED withdrawal (funds already held in clearing) into
 * a signed, broadcast USDT transfer, then record its real txHash. Kept separate from the ledger
 * state machine so the money movement (ledger) and the chain movement (signing) are independently
 * reviewable, and so the hot key is only imported here.
 */

/** Build the signer config from the environment. Throws if no key backend is provisioned yet. */
export function signerConfigFromEnv(): SignerConfig {
  return {
    apiUrl: tronApiUrl(),
    apiKey: tronApiKey(),
    contractAddress: usdtContract(),
    signer: signerFromEnv(),
    feeLimitSun: withdrawalFeeLimitSun(),
  };
}

/**
 * Take an APPROVED withdrawal on-chain. Builds → signs → broadcasts the transfer from the hot wallet,
 * then advances the withdrawal to BROADCASTING with the real txHash.
 *
 * BUG-09: broadcast is NOT safe to treat as all-or-nothing. TronGrid's node can accept the transaction
 * into its mempool and then lose the response to us (timeout, connection reset) — the funds then leave
 * the wallet on-chain even though this call sees a throw. The old code rolled the clearing hold back on
 * ANY throw from a combined sign+broadcast, including that one: the player got their balance back AND
 * the on-chain payment, and a retry from the admin's `/internal/withdrawals/:id/sign-broadcast` route
 * built and signed a SECOND transfer for the same withdrawal.
 *
 * So the two failure modes are handled differently:
 *  - build/sign fails (nothing ever reached the chain — safe to assume-failed): roll back, funds return.
 *  - broadcast fails (ambiguous — may or may not be live on-chain): keep the clearing hold, alert ops
 *    with the txID, and throw. The withdrawal stays APPROVED with `pendingTxId` set, which blocks any
 *    further send attempt until a human resolves it (see the reject/broadcast routes in routes.ts).
 *
 * Returns the on-chain txHash.
 */
export async function signAndBroadcastWithdrawal(
  withdrawalId: string,
  cfg: SignerConfig = signerConfigFromEnv(),
): Promise<string> {
  const w = await WithdrawalModel.findById(withdrawalId);
  if (!w) throw new WithdrawalNotFoundError(withdrawalId);
  if (w.state !== WithdrawalState.APPROVED) {
    throw new Error(`withdrawal ${withdrawalId} is ${w.state}, expected APPROVED`);
  }
  // A previous attempt left an unresolved broadcast — never build a second transfer on top of it.
  // A human must confirm (it landed) or reject (it's expired/never landed) it first.
  if (w.pendingTxId) {
    throw new Error(
      `withdrawal ${withdrawalId} already broadcast ${w.pendingTxId} — confirm or reject it, never re-send`,
    );
  }
  const amountUnits = usdtToUnits(Money.fromDecimal128(w.amount).toString());

  let signed;
  try {
    signed = await buildAndSignTransfer(cfg, w.address, amountUnits);
  } catch (err) {
    // Nothing left the wallet: build/sign never talks to the chain, only to TronGrid's builder and the
    // local/KMS signer. Safe to assume-failed and refund.
    await rollbackWithdrawal(withdrawalId, `build/sign failed: ${errMsg(err)}`);
    throw err;
  }

  // Record the pending send BEFORE broadcasting, and only if the withdrawal is still exactly where we
  // last saw it (APPROVED, nobody else's pendingTxId already sitting here). This is a CAS, not a
  // courtesy check: two concurrent sign-broadcast calls both pass the state check above, but only one
  // can win this updateOne, and the loser must not go on to broadcast.
  const claimed = await WithdrawalModel.updateOne(
    { _id: withdrawalId, state: WithdrawalState.APPROVED, pendingTxId: { $exists: false } },
    { $set: { pendingTxId: signed.tx.txID } },
  );
  if (claimed.modifiedCount !== 1) {
    throw new Error(
      `withdrawal ${withdrawalId} changed under us (state or pendingTxId) — refusing to broadcast a second transfer`,
    );
  }

  try {
    await broadcastSigned(cfg, signed.tx, signed.signatureHex);
  } catch (err) {
    // AMBIGUOUS: broadcastSigned's own doc comment explains why this is not safe to assume-failed.
    // The clearing hold stays put — do NOT roll back — and a human reconciles `pendingTxId` against
    // the chain. (A signed TRON tx also expires — raw_data.expiration, ~60s from build here — so once
    // that has passed AND the chain confirms it never landed, this is safe to roll back; that check is
    // manual for now, not automated here.)
    await alertOps('withdrawal broadcast ambiguous — manual check', {
      withdrawalId,
      txId: signed.tx.txID,
      error: errMsg(err),
    });
    throw err;
  }
  await broadcastWithdrawal(withdrawalId, signed.tx.txID);
  return signed.tx.txID;
}
