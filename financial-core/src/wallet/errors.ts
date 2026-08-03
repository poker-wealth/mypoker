import type { AccountType } from '../domain/account-types';

/** Base class for all Financial Core domain errors. */
export class FinancialCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * CB6 — a fund movement was attempted along a non-whitelisted clearing path.
 * Always accompanied by a security_log entry and an ops alert.
 */
export class IllegalFundFlowError extends FinancialCoreError {
  constructor(
    public readonly fromType: AccountType,
    public readonly toType: AccountType,
  ) {
    super(`Illegal fund flow: ${fromType} -> ${toType}`);
  }
}

/** Source account does not have enough available balance for the requested debit. */
export class InsufficientBalanceError extends FinancialCoreError {
  constructor(public readonly accountId: string) {
    super(`Insufficient available balance in account ${accountId}`);
  }
}

/** A referenced account does not exist. */
export class AccountNotFoundError extends FinancialCoreError {
  constructor(public readonly accountId: string) {
    super(`Account not found: ${accountId}`);
  }
}

/**
 * Optimistic-lock conflict: the account changed under us mid-transfer. Retryable — the transfer
 * runner re-reads and retries with backoff.
 */
export class VersionConflictError extends FinancialCoreError {
  constructor(public readonly accountId: string) {
    super(`Version conflict on account ${accountId} (retryable)`);
  }
}

/** A referenced withdrawal does not exist. */
export class WithdrawalNotFoundError extends FinancialCoreError {
  constructor(public readonly withdrawalId: string) {
    super(`Withdrawal not found: ${withdrawalId}`);
  }
}

/** Attempted an illegal withdrawal state transition (also guards against double withdrawal). */
export class InvalidWithdrawalTransitionError extends FinancialCoreError {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid withdrawal transition: ${from} -> ${to}`);
  }
}
