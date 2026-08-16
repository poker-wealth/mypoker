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
  WithdrawalNotFoundError,
} from '../wallet/errors';
import { WithdrawalModel, type WithdrawalDoc } from './withdrawal.model';
import { networkLabel } from '../config/chain';
import {
  announceWithdrawalRequested,
  announceWithdrawalSent,
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

/** BROADCASTING: record the on-chain tx hash. Funds remain held in clearing. */
export async function broadcastWithdrawal(withdrawalId: string, txHash: string): Promise<void> {
  const w = await loadOrThrow(withdrawalId);
  assertTransition(w.state, WithdrawalState.BROADCASTING);
  const moved = await WithdrawalModel.updateOne(
    { _id: withdrawalId, state: WithdrawalState.APPROVED },
    { $set: { state: WithdrawalState.BROADCASTING, txHash } },
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
}

/**
 * ROLLED_BACK: terminal failure. If the amount was held in clearing (APPROVED/BROADCASTING),
 * release it back to available. From REQUESTED there is nothing to release.
 */
export async function rollbackWithdrawal(withdrawalId: string, reason: string): Promise<void> {
  const w = await loadOrThrow(withdrawalId);
  assertTransition(w.state, WithdrawalState.ROLLED_BACK);
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

    const moved = await WithdrawalModel.updateOne(
      { _id: withdrawalId, state: w.state },
      { $set: { state: WithdrawalState.ROLLED_BACK, failureReason: reason } },
      { session },
    );
    if (moved.matchedCount === 0) {
      throw new InvalidWithdrawalTransitionError(w.state, WithdrawalState.ROLLED_BACK);
    }
  });
}
