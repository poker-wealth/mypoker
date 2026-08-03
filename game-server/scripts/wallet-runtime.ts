/**
 * Wallet runtime for the Mini App demo — an in-memory mirror of the Financial Core's rules.
 *
 * This is NOT the money engine. The authoritative one is the separately-tested Financial Core
 * (double-entry ledger, MongoDB transactions, circuit breakers — see `npm run smoke`). This runtime
 * exists so the wallet SCREEN has something faithful to drive, and it deliberately enforces the same
 * invariants the real core does, so the UI never implies a behaviour the core would reject:
 *
 *   • Three balances: available (spendable) / locked (in a live buy-in) / clearing (a withdrawal
 *     in flight). Only `available` can be spent or withdrawn.
 *   • A deposit is credited only after enough confirmations — a mempool (0-conf) deposit shows as
 *     pending and is NOT spendable, exactly as the core refuses to credit it.
 *   • Withdrawal lifecycle REQUESTED → APPROVED → BROADCASTING → CONFIRMED; the funds move
 *     available → clearing at APPROVED and leave at CONFIRMED. Locked funds can never be withdrawn.
 *
 * All amounts are micro-USD (6dp), like the core.
 */

const CONFIRMATIONS_REQUIRED = 20;

export type WithdrawalState = 'REQUESTED' | 'APPROVED' | 'BROADCASTING' | 'CONFIRMED';

export interface Balances {
  available: number;
  locked: number;
  clearing: number;
}

export type TxKind = 'DEPOSIT' | 'WITHDRAW' | 'BUY_IN' | 'CASH_OUT';

export interface Tx {
  id: string;
  kind: TxKind;
  amount: number;
  status: string; // 'PENDING' | 'CONFIRMED' | a WithdrawalState
  at: number;
  /** For a pending deposit: confirmations so far, out of CONFIRMATIONS_REQUIRED. */
  confirmations?: number;
}

export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletError';
  }
}

export class Wallet {
  private available = 0;
  private locked = 0;
  private clearing = 0;
  private readonly txs: Tx[] = [];
  private seq = 0;

  balances(): Balances {
    return { available: this.available, locked: this.locked, clearing: this.clearing };
  }
  total(): number {
    return this.available + this.locked + this.clearing;
  }
  history(): Tx[] {
    return [...this.txs].reverse(); // newest first
  }

  private id(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  /**
   * Start a deposit. It lands as PENDING (0 confirmations) and is NOT spendable until it reaches the
   * confirmation threshold — the same reason the core will not credit a mempool deposit.
   */
  startDeposit(amount: number): Tx {
    if (amount <= 0) throw new WalletError('deposit must be positive');
    const tx: Tx = {
      id: this.id('dep'),
      kind: 'DEPOSIT',
      amount,
      status: 'PENDING',
      at: 0,
      confirmations: 0,
    };
    this.txs.push(tx);
    return tx;
  }

  /** Advance a pending deposit's confirmations; credit `available` once it clears the threshold. */
  confirmDeposit(txId: string, addConfirmations = CONFIRMATIONS_REQUIRED): Tx {
    const tx = this.txs.find((t) => t.id === txId && t.kind === 'DEPOSIT');
    if (!tx || tx.status !== 'PENDING') throw new WalletError('no such pending deposit');
    tx.confirmations = Math.min(CONFIRMATIONS_REQUIRED, (tx.confirmations ?? 0) + addConfirmations);
    if (tx.confirmations >= CONFIRMATIONS_REQUIRED) {
      tx.status = 'CONFIRMED';
      this.available += tx.amount; // credited only now
    }
    return tx;
  }

  /**
   * Request a withdrawal. Only `available` may be withdrawn — never locked or clearing funds. The
   * amount moves available → clearing immediately (APPROVED), so it can't be double-spent while the
   * on-chain transfer is in flight.
   */
  requestWithdrawal(amount: number): Tx {
    if (amount <= 0) throw new WalletError('withdrawal must be positive');
    if (amount > this.available) {
      throw new WalletError('amount exceeds available balance (locked funds are not withdrawable)');
    }
    this.available -= amount;
    this.clearing += amount;
    const tx: Tx = { id: this.id('wd'), kind: 'WITHDRAW', amount, status: 'APPROVED', at: 0 };
    this.txs.push(tx);
    return tx;
  }

  /** Advance a withdrawal toward CONFIRMED; the funds leave `clearing` when it confirms. */
  advanceWithdrawal(txId: string): Tx {
    const tx = this.txs.find((t) => t.id === txId && t.kind === 'WITHDRAW');
    if (!tx) throw new WalletError('no such withdrawal');
    const next: Record<string, WithdrawalState> = {
      APPROVED: 'BROADCASTING',
      BROADCASTING: 'CONFIRMED',
    };
    const advanced = next[tx.status];
    if (!advanced) throw new WalletError(`withdrawal already ${tx.status}`);
    tx.status = advanced;
    if (advanced === 'CONFIRMED') this.clearing -= tx.amount; // funds have left the platform
    return tx;
  }

  /** Buy in to a table: available → locked (frozen, not withdrawable). */
  buyIn(amount: number): void {
    if (amount > this.available) throw new WalletError('insufficient available balance');
    this.available -= amount;
    this.locked += amount;
    this.txs.push({ id: this.id('buy'), kind: 'BUY_IN', amount, status: 'CONFIRMED', at: 0 });
  }

  /** Leave a table: locked → available (settled net comes back). */
  cashOut(amount: number): void {
    const move = Math.min(amount, this.locked);
    this.locked -= move;
    this.available += move;
    this.txs.push({ id: this.id('out'), kind: 'CASH_OUT', amount: move, status: 'CONFIRMED', at: 0 });
  }
}

/** One demo wallet, seeded so the screen isn't empty on first open. */
export const demoWallet = new Wallet();
{
  const seed = demoWallet.startDeposit(500_000_000); // $500
  demoWallet.confirmDeposit(seed.id);
  demoWallet.buyIn(150_000_000); // $150 sitting at a table
}
