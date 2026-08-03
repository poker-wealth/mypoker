import mongoose, { type ClientSession } from 'mongoose';
import { Money } from '../domain/money';
import { AccountType, LedgerType, LedgerDirection, LedgerStatus } from '../domain/account-types';
import { AccountModel } from './account.model';
import { LedgerModel } from './ledger.model';
import { isFlowAllowed } from '../clearing/clearing-rules';
import { SecurityLogModel } from '../security/security-log.model';
import { alertOps } from '../lib/alert';
import {
  AccountNotFoundError,
  IllegalFundFlowError,
  InsufficientBalanceError,
} from './errors';

/**
 * transfer() — the ONLY way funds move in the platform (FairPlay §3.3, M1 Remediation).
 *
 * Steps, all inside one MongoDB transaction (≤50ms target):
 *   1. ClearingRules whitelist check  — non-whitelisted flow → reject + security_log + ops alert (CB6)
 *   2. Idempotency check              — repeat key → no-op, returns already-processed
 *   3. Atomic debit of source         — `availableBalance >= amount` guard prevents overdraft
 *   4. Atomic credit of destination
 *   5. Double-entry ledger write      — matched DEBIT + CREDIT pair sharing the idempotency key
 *
 * Direct balance UPDATEs anywhere else in the codebase are forbidden.
 */

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: Money;
  type: LedgerType;
  /** Unique per logical movement. Guarantees exactly-once application. */
  idempotencyKey: string;
  /** Domain event id (roundId / withdrawalId / depositTxHash …). */
  businessId?: string;
  metadata?: Record<string, unknown>;
}

export interface TransferResult {
  idempotencyKey: string;
  /** true if funds moved on this call; false if it was a replay of an already-processed key. */
  applied: boolean;
}

const TXN_MAX_MS = Number(process.env.SETTLEMENT_TXN_MAX_MS ?? 50);

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Run a function inside a MongoDB transaction with the driver's automatic retry of transient
 * errors and commit-result ambiguity. Correctness under concurrency comes from the transaction
 * plus the `availableBalance >= amount` debit guard — overdraft and lost updates are impossible.
 */
export async function runTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  let result: T;
  try {
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' },
    );
  } finally {
    await session.endSession();
  }
  // result is always assigned if withTransaction resolved.
  return result!;
}

/** Assert a flow is whitelisted; throw (no logging) if not. Used inside transactions as a guard. */
function assertFlowAllowed(fromType: AccountType, toType: AccountType): void {
  if (!isFlowAllowed(fromType, toType)) {
    throw new IllegalFundFlowError(fromType, toType);
  }
}

/**
 * The in-transaction core of a transfer, reusable by the settlement engine (many transfers, one
 * transaction). Runs the FULL guard set against the provided session: clearing whitelist,
 * idempotency, overdraft-proof debit, credit, double-entry ledger.
 *
 * Returns `true` if funds moved, `false` if this idempotency key was already applied. Throws on
 * overdraft / illegal flow; lets duplicate-key bubble up so the caller can treat it as a replay.
 */
export async function transferInSession(
  input: TransferInput,
  session: ClientSession,
): Promise<boolean> {
  if (!input.amount.isPositive()) {
    throw new RangeError('transfer amount must be > 0');
  }

  const [from, to] = await Promise.all([
    AccountModel.findById(input.fromAccountId).session(session),
    AccountModel.findById(input.toAccountId).session(session),
  ]);
  if (!from) throw new AccountNotFoundError(input.fromAccountId);
  if (!to) throw new AccountNotFoundError(input.toAccountId);

  // 1. Clearing whitelist (defense in depth — standalone transfer() also pre-checks + logs).
  assertFlowAllowed(from.accountType, to.accountType);

  // 2. Idempotency: already applied within/before this transaction → no-op.
  const existing = await LedgerModel.exists({ idempotencyKey: input.idempotencyKey }).session(
    session,
  );
  if (existing) return false;

  const amountD = input.amount.toDecimal128();
  const negAmountD = input.amount.negate().toDecimal128();

  // 3. Debit source — the $gte guard makes overdraft impossible regardless of concurrency.
  const debit = await AccountModel.updateOne(
    { _id: input.fromAccountId, availableBalance: { $gte: amountD } },
    { $inc: { availableBalance: negAmountD, version: 1 } },
    { session },
  );
  if (debit.matchedCount === 0) {
    throw new InsufficientBalanceError(input.fromAccountId);
  }

  // 4. Credit destination.
  await AccountModel.updateOne(
    { _id: input.toAccountId },
    { $inc: { availableBalance: amountD, version: 1 } },
    { session },
  );

  // 5. Double-entry ledger: matched DEBIT + CREDIT sharing the idempotency key.
  await LedgerModel.create(
    [
      {
        idempotencyKey: input.idempotencyKey,
        businessId: input.businessId,
        accountId: input.fromAccountId,
        counterpartyAccountId: input.toAccountId,
        direction: LedgerDirection.DEBIT,
        amount: amountD,
        type: input.type,
        status: LedgerStatus.SETTLED,
        metadata: input.metadata,
      },
      {
        idempotencyKey: input.idempotencyKey,
        businessId: input.businessId,
        accountId: input.toAccountId,
        counterpartyAccountId: input.fromAccountId,
        direction: LedgerDirection.CREDIT,
        amount: amountD,
        type: input.type,
        status: LedgerStatus.SETTLED,
        metadata: input.metadata,
      },
    ],
    { session, ordered: true },
  );

  return true;
}

export async function transfer(input: TransferInput): Promise<TransferResult> {
  if (!input.amount.isPositive()) {
    throw new RangeError('transfer amount must be > 0');
  }

  // Load both accounts to validate existence + types (needed for the clearing check).
  const [from, to] = await Promise.all([
    AccountModel.findById(input.fromAccountId),
    AccountModel.findById(input.toAccountId),
  ]);
  if (!from) throw new AccountNotFoundError(input.fromAccountId);
  if (!to) throw new AccountNotFoundError(input.toAccountId);

  // 1. ClearingRules (CB6). Logged + alerted OUTSIDE any transaction so the evidence survives.
  if (!isFlowAllowed(from.accountType, to.accountType)) {
    await SecurityLogModel.create([
      {
        event: 'ILLEGAL_FUND_FLOW',
        detail: {
          fromType: from.accountType,
          toType: to.accountType,
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amount: input.amount.toString(),
          type: input.type,
          idempotencyKey: input.idempotencyKey,
        },
      },
    ]);
    await alertOps(`Illegal fund flow: ${from.accountType} -> ${to.accountType}`, {
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount: input.amount.toString(),
    });
    throw new IllegalFundFlowError(from.accountType, to.accountType);
  }

  // 2. Idempotency fast-path: already applied → no-op.
  const existing = await LedgerModel.exists({ idempotencyKey: input.idempotencyKey });
  if (existing) {
    return { idempotencyKey: input.idempotencyKey, applied: false };
  }

  const started = Date.now();
  try {
    await runTransaction((session) => transferInSession(input, session));
  } catch (err) {
    // Concurrent duplicate: the other transfer won the unique index. Treat as already-processed.
    if (isDuplicateKeyError(err)) {
      return { idempotencyKey: input.idempotencyKey, applied: false };
    }
    throw err;
  }

  const elapsed = Date.now() - started;
  if (elapsed > TXN_MAX_MS) {
    // 50ms hard limit is a monitored target (spec §3, Pitfall 1). Surface breaches for tuning.
    await alertOps(`transfer() local transaction exceeded ${TXN_MAX_MS}ms (${elapsed}ms)`, {
      idempotencyKey: input.idempotencyKey,
      type: input.type,
    });
  }

  return { idempotencyKey: input.idempotencyKey, applied: true };
}
