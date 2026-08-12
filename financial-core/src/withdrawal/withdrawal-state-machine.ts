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
  return doc!._id;
}

/** APPROVED: atomically move amount available → clearing (held, not spendable, not re-withdrawable). */
/**
 * The amount above which one approver is not enough (§3.6: APPROVED requires
 * "risk control passed + human review (> $10K)").
 *
 * Strictly greater than, matching the spec's `>`: exactly ₮10,000 clears on one
 * approval. A boundary read the other way would be defensible, but the spec
 * writes `> $10K` and a threshold that disagrees with the document is a
 * threshold someone will later "fix" in the wrong direction.
 */
export const SECOND_APPROVAL_THRESHOLD = Money.fromDecimalString('10000');

export interface ApprovalOutcome {
  /** True when this call moved the withdrawal to APPROVED and held the funds. */
  applied: boolean;
  /** Everyone who has approved so far, including this caller. */
  approvals: string[];
  /** Set when the amount needs a second person and only one has signed. */
  awaitingSecondApproval?: true;
}

/**
 * APPROVED: hold the funds, once enough people have said yes.
 *
 * `approvedBy` is required rather than optional. An approval with no name is
 * the state this function was in before — it released any sum on a single
 * anonymous call — and an optional parameter would let every existing caller
 * keep doing exactly that while looking fixed.
 *
 * Recording the approval and reading the tally happen in ONE atomic
 * `findOneAndUpdate`. Read-then-write would let two reviewers approving a large
 * withdrawal at the same moment both observe one signature, both write theirs,
 * and both proceed — releasing on two approvals that never saw each other,
 * which is the precise failure the second signature exists to prevent.
 *
 * The `state: REQUESTED` filter is what makes that safe: whoever wins the race
 * moves the state, and the loser's update matches nothing.
 */
export async function approveWithdrawal(
  withdrawalId: string,
  approvedBy: string,
): Promise<ApprovalOutcome> {
  if (!approvedBy) throw new WithdrawalNotFoundError(withdrawalId);

  const w = await loadOrThrow(withdrawalId);
  assertTransition(w.state, WithdrawalState.APPROVED);

  // Record this approver and read the resulting set in one step.
  const recorded = await WithdrawalModel.findOneAndUpdate(
    { _id: withdrawalId, state: WithdrawalState.REQUESTED },
    { $addToSet: { approvals: approvedBy } },
    { new: true },
  );
  if (!recorded) throw new InvalidWithdrawalTransitionError(w.state, WithdrawalState.APPROVED);

  const approvals = recorded.approvals ?? [];
  const needsSecond = Money.fromDecimal128(recorded.amount).greaterThan(SECOND_APPROVAL_THRESHOLD);
  if (needsSecond && approvals.length < 2) {
    // Deliberately still REQUESTED, and no funds moved. The withdrawal stays in
    // the queue for someone else to review.
    return { applied: false, approvals, awaitingSecondApproval: true };
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

    const moved = await WithdrawalModel.updateOne(
      { _id: withdrawalId, state: WithdrawalState.REQUESTED },
      { $set: { state: WithdrawalState.APPROVED } },
      { session },
    );
    if (moved.matchedCount === 0) {
      throw new InvalidWithdrawalTransitionError(w.state, WithdrawalState.APPROVED);
    }
  });

  return { applied: true, approvals };
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
