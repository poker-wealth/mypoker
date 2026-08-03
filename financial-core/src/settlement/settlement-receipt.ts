import { createHash } from 'node:crypto';
import type { Money } from '../domain/money';

/**
 * settlement_receipt (FairPlay §3.5) — the tamper-evident record of a settled round. Includes the
 * `accounts` field (which account each movement touched) and a SHA256 of all fields. Emitted by
 * settleRound and later anchored on-chain (async, never in the game critical path).
 */

export interface SettlementAmounts {
  jackpot: string;
  rake: string;
  payout: string;
}

export interface SettlementAccounts {
  jackpotMini: string;
  jackpotMinor: string;
  jackpotMajor: string;
  jackpotGrand: string;
  rakeDest: string;
  winner: string;
}

export interface SettlementReceipt {
  roundId: string;
  sequence: string[];
  amounts: SettlementAmounts;
  accounts: SettlementAccounts;
  hash: string;
}

export interface BuildReceiptInput {
  roundId: string;
  jackpotTotal: Money;
  rake: Money;
  payout: Money;
  accounts: SettlementAccounts;
}

export function buildSettlementReceipt(input: BuildReceiptInput): SettlementReceipt {
  const sequence = ['jackpot_inject', 'rake', 'payout'];
  const amounts: SettlementAmounts = {
    jackpot: input.jackpotTotal.toString(),
    rake: input.rake.toString(),
    payout: input.payout.toString(),
  };
  // Hash over a canonical, stable serialization of every field.
  const canonical = JSON.stringify({
    roundId: input.roundId,
    sequence,
    amounts,
    accounts: input.accounts,
  });
  const hash = createHash('sha256').update(canonical).digest('hex');
  return { roundId: input.roundId, sequence, amounts, accounts: input.accounts, hash };
}
