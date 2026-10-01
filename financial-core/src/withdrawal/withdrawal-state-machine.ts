import { randomUUID } from 'node:crypto';
import { Money } from '../domain/money';
import {
  AccountType,
  LedgerType,
  LedgerDirection,
  LedgerStatus,
} from '../domain/account-types';
import { WithdrawalState, canTransition, isHeldInClearing } from '../domain/withdrawal-types';
import { AccountModel } from '../wallet/account.model';
import { LedgerModel } from '../wallet/ledger.model';
import { runTransaction } from '../wallet/transfer';
import { getOrCreateExternalAccount } from '../wallet/system-accounts';
import {
  AccountNotFoundError,
  InsufficientBalanceError,
  InvalidWithdrawalTransitionError,
  WithdrawalBroadcastPendingError,
  WithdrawalNotFoundError,
} from '../wallet/errors';
import { WithdrawalModel, type WithdrawalDoc } from './withdrawal.model';
import { networkLabel } from '../config/chain';
import {
  announceWithdrawalRequested,
  announceWithdrawalSent,
  announceWithdrawalConfirmed,
  announceWithdrawalReturned,
} from '../notifications/email/money-mail';

/**
 * Withdrawal state machine (FairPlay §3.6). Each step moves funds across the player's
 * three-balance wallet atomically and advances state. The clearing hold is what prevents a second
 * withdrawal of the same funds. Final ledger entry (PLAYER → TREASURY) is written at CONFIRMED —
 * the only point where money actually leaves the platform.
 */

export interface RequestWithdrawalInput {
  playerAccountId: string;
  amount: Money;
  address: string;
}

async function loadOrThrow(withdrawalId: string): Promise<WithdrawalDoc> {
  const w = await WithdrawalModel.findById(withdrawalId);
  if (!w) throw new WithdrawalNotFoundError(withdrawalId);
  return w;
}

function assertTransition(from: WithdrawalState, to: WithdrawalState): void {
  if (!canTransition(from, to)) throw new InvalidWithdrawalTransitionError(from, to);
}

/** REQUESTED: record the request. Balance is NOT moved yet (risk review pending). */
export async function requestWithdrawal(input: RequestWithdrawalInput): Promise<string> {
  if (!input.amount.isPositive()) throw new RangeError('withdrawal amount must be > 0');

  const player = await AccountModel.findById(input.playerAccountId);
  if (!player) throw new AccountNotFoundError(input.playerAccountId);
  if (player.accountType !== AccountType.PLAYER) {
    throw new Error('withdrawals may only be requested from PLAYER accounts');
  }
  // Early sanity check on spendable funds (re-guarded atomically at APPROVED).
  if (Money.fromDecimal128(player.availableBalance).lessThan(input.amount)) {
    throw new InsufficientBalanceError(input.playerAccountId);
  }

  const [doc] = await WithdrawalModel.create([
    {
      _id: randomUUID(),
      playerAccountId: input.playerAccountId,
      amount: input.amount.toDecimal128(),
      address: input.address,
      state: WithdrawalState.REQUESTED,
    },
  ]);

  // The receipt. Sent at REQUESTED — before any balance moves — because this
  // is the message that tells a player about a withdrawal they did not make,
  // and it is worth least if it waits for the money to leave.
  await announceWithdrawalRequested({
    playerId: player.ownerId,
    withdrawalId: doc!._id,
    amount: input.amount.toString(),
    address: input.address,
  });

  return doc!._id;
}

/** Withdrawals strictly above this need TWO distinct approvers (spec: >$10K = second-person confirm). */
export function dualConfirmThreshold(): Money {
  return Money.fromDecimalString(process.env.WITHDRAWAL_DUAL_CONFIRM_USD ?? '10000');
}

/**
 * APPROVED: record `approverId`, and once enough DISTINCT approvers have signed off, atomically move
 * amount available → clearing (held, not spendable, not re-withdrawable) and advance to APPROVED.
 *
 * A large withdrawal (over the dual-confirm threshold, default $10K) needs two distinct approvers;
 * smaller ones need one. The tally is returned so an ops UI can show "1 of 2 approvals". The funds
 * are NOT held until the last required approval — an under-approved large withdrawal stays REQUESTED.
 */
export async function approveWithdrawal(
  withdrawalId: string,
  approverId: string,
): Promise<{ state: WithdrawalState; approvals: number; required: number }> {
  if (!approverId) throw new Error('approverId is required to approve a withdrawal');
  const w = await loadOrThrow(withdrawalId);
  if (w.state !== WithdrawalState.REQUESTED) {
    throw new InvalidWithdrawalTransitionError(w.state, WithdrawalState.APPROVED);
  }
  const required = Money.fromDecimal128(w.amount).greaterThan(dualConfirmThreshold()) ? 2 : 1;

  // Record this approver. $addToSet is idempotent — the same person cannot count as two.
  await WithdrawalModel.updateOne(
    { _id: withdrawalId, state: WithdrawalState.REQUESTED },
    { $addToSet: { approvals: approverId } },
  );
  const after = await loadOrThrow(withdrawalId);
  const approvals = (after.approvals ?? []).length;
  if (approvals < required) {
    return { state: after.state, approvals, required };
  }

  const amountD = w.amount;
  const negAmountD = Money.fromDecimal128(w.amount).negate().toDecimal128();
  await runTransaction(async (session) => {
    // Hold funds: available -= amount, clearing += amount (guard prevents overdraft / double-hold).
    const held = await AccountModel.updateOne(
      { _id: w.playerAccountId, availableBalance: { $gte: amountD } },
      { $inc: { availableBalance: negAmountD, clearingBalance: amountD, version: 1 } },
      { session },
    );
    if (held.matchedCount === 0) throw new InsufficientBalanceError(w.playerAccountId);

    // state:REQUESTED guard → only one concurrent caller makes the move; a loser's hold rolls back.
    const moved = await WithdrawalModel.updateOne(
      { _id: withdrawalId, state: WithdrawalState.REQUESTED },
      { $set: { state: WithdrawalState.APPROVED } },
      { session },
    );
    if (moved.matchedCount === 0) {
      throw new InvalidWithdrawalTransitionError(w.state, WithdrawalState.APPROVED);
    }
  });
  return { state: WithdrawalState.APPROVED, approvals, required };
}

/**
 * BROADCASTING: record the on-chain tx hash. Funds remain held in clearing.
 *
 * Also clears `pendingTxId` (BUG-09): once a txHash is recorded here, the send is no longer
 * ambiguous — either this call is the normal auto sign-broadcast follow-through (pendingTxId ===
 * txHash), or it's an admin resolving a stuck ambiguous send via the manual `/broadcast` route after
 * checking the chain, in which case pendingTxId has done its job (blocking a re-send) and should stop
 * blocking anything further.
 *
 * BUG-09 follow-up (D3): if `pendingTxId` is set to something OTHER than `txHash`, this refuses. The
 * manual `/broadcast` route lets an admin confirm a send with a txHash they read off the chain — without
 * this guard they could type (or the client could send) any txHash while a real broadcast is still
 * unresolved, silently discarding the actual pending send and recording a fabricated one instead.
 */
export interface BroadcastWithdrawalOptions {
  /**
   * BUG-09 follow-up (D10): when true, this refuses to record a send unless `txHash` is EXACTLY the
   * withdrawal's own unresolved `pendingTxId` — the "no pendingTxId at all → accept any txHash" arm
   * below is not available. That arm exists for the ordinary auto sign-broadcast follow-through
   * (there is nothing to compare against yet); an admin's manual "mark as sent" action is resolving a
   * SPECIFIC unresolved send they read off the chain, and if the withdrawal turns out not to have one
   * — already resolved, state moved on, stale screen — that is a bug to surface, not a hash to accept.
   */
  requirePending?: boolean;
  /** BUG-09 follow-up (D9): the admin who resolved this send via the manual `/broadcast` route, for the audit trail. */
  resolvedBy?: string;
}

export async function broadcastWithdrawal(
  withdrawalId: string,
  txHash: string,
  opts?: BroadcastWithdrawalOptions,
): Promise<void> {
  const w = await loadOrThrow(withdrawalId);
  assertTransition(w.state, WithdrawalState.BROADCASTING);
  if (opts?.requirePending) {
    if (w.pendingTxId !== txHash) {
      throw new WithdrawalBroadcastPendingError(
        withdrawalId,
        `withdrawal ${withdrawalId} has no unresolved broadcast matching txHash ${txHash} ` +
          `(pendingTxId: ${w.pendingTxId ?? 'none'}) — requirePending refuses to record a send that ` +
          'is not the one actually pending',
      );
    }
  } else if (w.pendingTxId && w.pendingTxId !== txHash) {
    throw new WithdrawalBroadcastPendingError(
      withdrawalId,
      `withdrawal ${withdrawalId} has a pending broadcast ${w.pendingTxId} — txHash ${txHash} does not ` +
        'match it, refusing (resolve the actual pending send, or reject with chainChecked:true)',
    );
  }
  // Filter accepts either no pendingTxId at all, or one that matches txHash exactly — atomically, so a
  // concurrent CAS onto pendingTxId between the read above and this write cannot slip a mismatched
  // txHash through. requirePending (D10) drops the "no pendingTxId at all" arm: the filter then only
  // matches a row whose pendingTxId is still exactly this txHash.
  const moved = await WithdrawalModel.updateOne(
    {
      _id: withdrawalId,
      state: WithdrawalState.APPROVED,
      ...(opts?.requirePending
        ? { pendingTxId: txHash }
        : { $or: [{ pendingTxId: { $exists: false } }, { pendingTxId: txHash }] }),
    },
    {
      $set: {
        state: WithdrawalState.BROADCASTING,
        txHash,
        ...(opts?.resolvedBy ? { resolvedBy: opts.resolvedBy } : {}),
      },
      $unset: { pendingTxId: '', pendingTxExpiration: '' },
    },
  );
  if (moved.matchedCount === 0) {
    throw new InvalidWithdrawalTransitionError(w.state, WithdrawalState.BROADCASTING);
  }

  // "It's on its way." Sent at BROADCASTING rather than CONFIRMED: the tx hash
  // exists from here, and that is the thing a player wants — something they
  // can paste into an explorer while they wait for confirmations.
  //
  // Guarded IN FULL, lookup included: everything from here down is
  // notification, and the transition above has already committed. Unguarded,
  // a transient DB error on this findById would reject the whole call — the
  // caller retries, the retry hits "already BROADCASTING", and the player's
  // "sent" notice is lost over a read that had nothing to do with the money.
  try {
    const player = await AccountModel.findById(w.playerAccountId);
    if (player) {
      await announceWithdrawalSent({
        playerId: player.ownerId,
        withdrawalId,
        amount: Money.fromDecimal128(w.amount).toString(),
        address: w.address,
        txHash,
        network: networkLabel(),
      });
    }
  } catch (err) {
    console.error('[withdrawal] sent-notice failed (state is committed):', err);
  }
}

/** CONFIRMED: funds leave the platform. Remove from clearing, settle to EXTERNAL, write WITHDRAW. */
export async function confirmWithdrawal(withdrawalId: string): Promise<void> {
  const w = await loadOrThrow(withdrawalId);
  assertTransition(w.state, WithdrawalState.CONFIRMED);
  const amountD = w.amount;
  const negAmountD = Money.fromDecimal128(w.amount).negate().toDecimal128();

  // Off-ramp: funds settle to the EXTERNAL boundary account (symmetric with deposits). TREASURY is
  // reserved for rake/income, not the deposit/withdrawal float.
  const external = await getOrCreateExternalAccount();

  await runTransaction(async (session) => {
    // Remove the held funds from the player's clearing balance.
    const cleared = await AccountModel.updateOne(
      { _id: w.playerAccountId, clearingBalance: { $gte: amountD } },
      { $inc: { clearingBalance: negAmountD, version: 1 } },
      { session },
    );
    if (cleared.matchedCount === 0) throw new InsufficientBalanceError(w.playerAccountId);

    // EXTERNAL receives the outflow (its balance rises by total withdrawn).
    await AccountModel.updateOne(
      { _id: external._id },
      { $inc: { availableBalance: amountD, version: 1 } },
      { session },
    );

    // Double-entry WITHDRAW: DEBIT player, CREDIT external.
    await LedgerModel.create(
      [
        {
          idempotencyKey: `withdraw:${withdrawalId}`,
          businessId: withdrawalId,
          accountId: w.playerAccountId,
          counterpartyAccountId: external._id,
          direction: LedgerDirection.DEBIT,
          amount: amountD,
          type: LedgerType.WITHDRAW,
          status: LedgerStatus.SETTLED,
          metadata: { address: w.address, txHash: w.txHash },
        },
        {
          idempotencyKey: `withdraw:${withdrawalId}`,
          businessId: withdrawalId,
          accountId: external._id,
          counterpartyAccountId: w.playerAccountId,
          direction: LedgerDirection.CREDIT,
          amount: amountD,
          type: LedgerType.WITHDRAW,
          status: LedgerStatus.SETTLED,
          metadata: { address: w.address, txHash: w.txHash },
        },
      ],
      { session, ordered: true },
    );

    const moved = await WithdrawalModel.updateOne(
      { _id: withdrawalId, state: WithdrawalState.BROADCASTING },
      { $set: { state: WithdrawalState.CONFIRMED } },
      { session },
    );
    if (moved.matchedCount === 0) {
      throw new InvalidWithdrawalTransitionError(w.state, WithdrawalState.CONFIRMED);
    }
  });

  // The end of the story. The BROADCAST message told the player "arrival
  // depends on confirmations" and nothing ever followed it, so they had to go
  // and check their own wallet to learn whether they had been paid.
  //
  // After the transaction, like every other announce here: a mail server having
  // a bad afternoon must not undo a withdrawal that is already on-chain final.
  const account = await AccountModel.findById(w.playerAccountId).lean();
  if (account) {
    await announceWithdrawalConfirmed({
      playerId: account.ownerId,
      withdrawalId,
      amount: Money.fromDecimal128(w.amount).toString(),
      address: w.address,
      txHash: w.txHash ?? '',
      network: networkLabel(),
    });
  }
}

export interface RollbackWithdrawalOptions {
  /**
   * BUG-09 (D1): by default, rollback refuses a withdrawal with an unresolved broadcast
   * (`pendingTxId` set) — it may already be live on-chain, and refunding it risks a double-pay. Pass
   * `true` only once the caller has explicitly confirmed (chain-checked) it's safe — mirrors the
   * `chainChecked` flag on the reject route, the only caller that ever sets this.
   */
  allowPendingTx?: boolean;
  /**
   * BUG-09 follow-up (D7): restrict which states this may roll back FROM. `w.state` (read just above,
   * before the atomic write) is checked against this list and throws immediately if it doesn't match —
   * and the write below stays CAS-safe even so, because its filter pins `state: w.state`, the very
   * state this check just approved. If the row has since moved to a state that check never saw (e.g.
   * the watcher advancing it to BROADCASTING mid-review), the filter simply fails to match and the
   * generic `matchedCount === 0` branch throws the same error — the fast check here is a clearer
   * message, not the only guard.
   *
   * The reject route (the only caller a human drives) passes `[REQUESTED, APPROVED]` — a live
   * BROADCASTING withdrawal is refundable only by the watcher, which actually checks the chain before
   * doing it. Every other caller (the watcher itself, build/sign's own rollback) passes nothing.
   */
  fromStates?: WithdrawalState[];
  /**
   * BUG-09 follow-up (D13): required whenever `allowPendingTx` is true — the EXACT `pendingTxId` the
   * caller chain-checked. Without this, `allowPendingTx` used to drop the pendingTxId guard from the
   * filter entirely (matching ANY pendingTxId), which refunds whatever happens to be pending by the
   * time the write lands, not the one the caller actually looked at: a watcher release (reconcile
   * clearing an expired `pendingTxId`, state staying APPROVED) followed by a re-send CAS
   * (withdrawal-broadcast.ts's `claimed` update) can plant a fresh, LIVE `pendingTxId` in the gap
   * between an admin's chain-check and this call. The atomic filter below now pins on
   * `expectedPendingTxId` instead of dropping the guard, so a `pendingTxId` that changes in that gap
   * fails to match and falls into the ordinary `matchedCount === 0` branch — refund refused, not a
   * tx nobody ever chain-checked.
   */
  expectedPendingTxId?: string;
  /** BUG-09 follow-up (D9): the admin who refused this withdrawal, for the audit trail. */
  rejectedBy?: string;
  /**
   * BUG-09 follow-up (D9): who confirmed the chain check that authorized `allowPendingTx`. Defaults to
   * `rejectedBy` — refusing a withdrawal with an unresolved broadcast is, in practice, one admin doing
   * both in the same action — but is its own field because that need not always be true.
   */
  chainCheckedBy?: string;
}

/**
 * ROLLED_BACK: terminal failure. If the amount was held in clearing (APPROVED/BROADCASTING),
 * release it back to available. From REQUESTED there is nothing to release.
 *
 * BUG-09 (D1): the `pendingTxId` guard is enforced IN the atomic filter below, not only by a caller
 * reading the withdrawal first and deciding whether to call this. A read-then-decide check has a race
 * — a send can CAS `pendingTxId` onto the withdrawal between that read and this call — so the filter
 * itself refuses to match a row that has since grown a `pendingTxId` the caller never saw or OK'd.
 *
 * BUG-09 follow-up (D13): `allowPendingTx` alone is not enough to authorize a refund — it must name
 * the exact tx (`expectedPendingTxId`) it was told is safe. Passing `allowPendingTx` without it is a
 * caller bug (a chain-check that never actually named the tx it checked) and throws immediately,
 * before touching the database.
 */
export async function rollbackWithdrawal(
  withdrawalId: string,
  reason: string,
  opts?: RollbackWithdrawalOptions,
): Promise<void> {
  if (opts?.allowPendingTx && !opts.expectedPendingTxId) {
    throw new Error(
      'rollbackWithdrawal: allowPendingTx requires expectedPendingTxId naming the pendingTxId that was chain-checked',
    );
  }
  const w = await loadOrThrow(withdrawalId);
  assertTransition(w.state, WithdrawalState.ROLLED_BACK);
  if (opts?.fromStates && !opts.fromStates.includes(w.state)) {
    throw new InvalidWithdrawalTransitionError(w.state, WithdrawalState.ROLLED_BACK);
  }
  const amountD = w.amount;
  const negAmountD = Money.fromDecimal128(w.amount).negate().toDecimal128();
  const releaseHold = isHeldInClearing(w.state);

  await runTransaction(async (session) => {
    if (releaseHold) {
      const released = await AccountModel.updateOne(
        { _id: w.playerAccountId, clearingBalance: { $gte: amountD } },
        { $inc: { clearingBalance: negAmountD, availableBalance: amountD, version: 1 } },
        { session },
      );
      if (released.matchedCount === 0) throw new InsufficientBalanceError(w.playerAccountId);
    }

    // D9: `pendingTxId`/`pendingTxExpiration` are deliberately NOT `$unset` here even when
    // allowPendingTx let this through — they are the record of exactly which broadcast an admin
    // chain-checked and refunded. Clearing them would make a ROLLED_BACK-with-a-pendingTxId doc
    // indistinguishable from an ordinary one, which is the one thing an investigator into a suspected
    // double-pay most needs to find.
    const moved = await WithdrawalModel.updateOne(
      {
        _id: withdrawalId,
        state: w.state,
        // D13: allowPendingTx pins the filter to the EXACT tx the caller named, rather than dropping
        // the pendingTxId guard entirely — a mismatch (the tx changed since the caller chain-checked
        // it) falls through to matchedCount === 0 below, same as any other lost race.
        ...(opts?.allowPendingTx
          ? { pendingTxId: opts.expectedPendingTxId }
          : { pendingTxId: { $exists: false } }),
      },
      {
        $set: {
          state: WithdrawalState.ROLLED_BACK,
          failureReason: reason,
          ...(opts?.rejectedBy ? { rejectedBy: opts.rejectedBy } : {}),
          ...(opts?.allowPendingTx && (opts?.chainCheckedBy ?? opts?.rejectedBy)
            ? { chainCheckedBy: opts.chainCheckedBy ?? opts.rejectedBy }
            : {}),
        },
      },
      { session },
    );
    if (moved.matchedCount === 0) {
      throw new InvalidWithdrawalTransitionError(w.state, WithdrawalState.ROLLED_BACK);
    }
  });

  // The player asked for their money, was told "you will get another email when
  // it is sent" — and then, if it was refused or the send failed, was told
  // nothing at all, ever. They were left waiting on an email that would never
  // come, for money that was quietly already back in their balance.
  //
  // `reason` is deliberately NOT sent to the player: it carries the refusing
  // administrator's id and internal failure text. What they need is the
  // outcome, which is the same either way.
  const account = await AccountModel.findById(w.playerAccountId).lean();
  if (account) {
    await announceWithdrawalReturned({
      playerId: account.ownerId,
      withdrawalId,
      amount: Money.fromDecimal128(w.amount).toString(),
      address: w.address,
    });
  }
}
