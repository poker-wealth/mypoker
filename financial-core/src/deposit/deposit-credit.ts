import { Money } from '../domain/money';
import {
  AccountType,
  LedgerType,
  LedgerDirection,
  LedgerStatus,
} from '../domain/account-types';
import { AccountModel } from '../wallet/account.model';
import { LedgerModel } from '../wallet/ledger.model';
import { runTransaction } from '../wallet/transfer';
import { getOrCreateExternalAccount } from '../wallet/system-accounts';
import { isFlowAllowed } from '../clearing/clearing-rules';
import { AccountNotFoundError, IllegalFundFlowError } from '../wallet/errors';
import { alertOps } from '../lib/alert';
import { SecurityLogModel } from '../security/security-log.model';
import { isOfficialContract, isConfirmed } from './trc20';
import { networkLabel } from '../config/chain';
import { announceDeposit } from '../notifications/email/money-mail';
import { sendTelegram } from '../notifications/telegram/send-telegram';
import { nonOfficialContract } from '../notifications/telegram/messages';

/**
 * Deposit crediting (FairPlay §3.7). A confirmed on-chain USDT deposit is recorded as the
 * double-entry movement EXTERNAL → PLAYER. The on-chain txHash is the idempotency key, so the same
 * deposit can never be credited twice (DB-level unique guard).
 */

export interface CreditDepositInput {
  playerAccountId: string;
  amount: Money;
  /** On-chain transaction hash — the idempotency key. */
  txHash: string;
  metadata?: Record<string, unknown>;
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/** Credit a confirmed deposit. Idempotent on txHash. Returns false if already credited. */
export async function creditDeposit(input: CreditDepositInput): Promise<{ credited: boolean }> {
  if (!input.amount.isPositive()) throw new RangeError('deposit amount must be > 0');

  const player = await AccountModel.findById(input.playerAccountId);
  if (!player) throw new AccountNotFoundError(input.playerAccountId);
  if (player.accountType !== AccountType.PLAYER) {
    throw new Error('deposits may only credit PLAYER accounts');
  }

  const external = await getOrCreateExternalAccount();
  // Defense in depth: EXTERNAL → PLAYER must be whitelisted.
  if (!isFlowAllowed(external.accountType, player.accountType)) {
    throw new IllegalFundFlowError(external.accountType, player.accountType);
  }

  const key = `deposit:${input.txHash}`;
  if (await LedgerModel.exists({ idempotencyKey: key })) {
    return { credited: false };
  }

  const amountD = input.amount.toDecimal128();
  const negAmountD = input.amount.negate().toDecimal128();

  try {
    await runTransaction(async (session) => {
      const dup = await LedgerModel.exists({ idempotencyKey: key }).session(session);
      if (dup) return;

      // EXTERNAL is the boundary account — it may go negative, so NO overdraft guard here.
      await AccountModel.updateOne(
        { _id: external._id },
        { $inc: { availableBalance: negAmountD, version: 1 } },
        { session },
      );
      await AccountModel.updateOne(
        { _id: input.playerAccountId },
        { $inc: { availableBalance: amountD, version: 1 } },
        { session },
      );
      await LedgerModel.create(
        [
          {
            idempotencyKey: key,
            businessId: input.txHash,
            accountId: external._id,
            counterpartyAccountId: input.playerAccountId,
            direction: LedgerDirection.DEBIT,
            amount: amountD,
            type: LedgerType.DEPOSIT,
            status: LedgerStatus.SETTLED,
            metadata: input.metadata,
          },
          {
            idempotencyKey: key,
            businessId: input.txHash,
            accountId: input.playerAccountId,
            counterpartyAccountId: external._id,
            direction: LedgerDirection.CREDIT,
            amount: amountD,
            type: LedgerType.DEPOSIT,
            status: LedgerStatus.SETTLED,
            metadata: input.metadata,
          },
        ],
        { session, ordered: true },
      );
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) return { credited: false };
    throw err;
  }

  // AFTER the credit is written, and only when it actually was. Announcing a
  // deposit that failed to commit is worse than announcing none: a player
  // reads "₮500.00 received", checks the balance, and finds nothing.
  //
  // Awaited rather than fired and forgotten, because a floating promise in a
  // serverless or short-lived process is a message that never gets sent —
  // announce() swallows its own failures, so awaiting costs correctness
  // nothing and cannot fail this credit.
  await announceDeposit({
    playerId: player.ownerId,
    amount: input.amount.toString(),
    txHash: input.txHash,
    network: networkLabel(),
  });

  return { credited: true };
}

export interface OnChainDepositEvent {
  playerAccountId: string;
  amount: Money;
  txHash: string;
  contractAddress: string;
  confirmations: number;
}

export type DepositOutcome =
  | { credited: true }
  | { credited: false; reason: 'wrong_contract' | 'unconfirmed' | 'already_credited' };

/**
 * Gate a raw on-chain deposit event through the TRC-20 rules, then credit it.
 *   - Non-official contract → never credited (logged + ops alert + the player is told).
 *   - Fewer than 20 confirmations (incl. mempool) → never credited; caller re-checks later.
 */
export async function processConfirmedDeposit(
  event: OnChainDepositEvent,
): Promise<DepositOutcome> {
  if (!isOfficialContract(event.contractAddress)) {
    await SecurityLogModel.create([
      {
        event: 'NON_OFFICIAL_CONTRACT_DEPOSIT',
        detail: {
          contractAddress: event.contractAddress,
          txHash: event.txHash,
          playerAccountId: event.playerAccountId,
        },
      },
    ]);
    await alertOps('Deposit from non-official contract ignored', {
      contractAddress: event.contractAddress,
      txHash: event.txHash,
    });

    // Tell the PLAYER, not just ops. The spec is explicit — "send to wrong
    // contract → no credit, TG notification sent" — and this comment used to
    // claim they were "notified upstream" when nothing notified them at all.
    //
    // It is the one message here that is not a receipt. Someone has sent real
    // funds to a contract the platform does not accept; silence would leave
    // them waiting for a deposit that is never coming, and the transaction id
    // is what support needs to help them.
    //
    // Wrapped, like every other announce: a failed message must not change the
    // outcome of a deposit that was already rejected.
    try {
      const account = await AccountModel.findById(event.playerAccountId).lean();
      if (account) {
        await sendTelegram(
          account.ownerId,
          nonOfficialContract({ txHash: event.txHash }),
          `deposit:${event.txHash}:rejected`,
        );
      }
    } catch (err) {
      console.error(`[deposit] could not notify ${event.txHash} rejection:`, err);
    }

    return { credited: false, reason: 'wrong_contract' };
  }

  if (!isConfirmed(event.confirmations)) {
    // Mempool / not enough confirmations — do NOT credit. Caller polls again later.
    return { credited: false, reason: 'unconfirmed' };
  }

  const result = await creditDeposit({
    playerAccountId: event.playerAccountId,
    amount: event.amount,
    txHash: event.txHash,
    metadata: { contractAddress: event.contractAddress },
  });
  return result.credited ? { credited: true } : { credited: false, reason: 'already_credited' };
}
