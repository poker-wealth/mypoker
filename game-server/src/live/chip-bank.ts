import type {
  FinancialCoreClient,
  SettleRoundRequest,
  SettlementReceipt,
  TableSettlementRequest,
} from '../core/financial-core-client';
import type { ChipLedger } from './players';

/**
 * ChipBank — a play-chip implementation of `FinancialCoreClient`.
 *
 * A hand settles the only way the table is allowed to settle: the game hands a settlement request
 * to a `FinancialCoreClient` (iron rule #3 — the table never writes a balance itself). This
 * implementation applies that request to a local `ChipLedger`, so real people play real hands
 * against each other with no MongoDB/Redis to stand up. Construct the room with
 * `HttpFinancialCoreClient` instead and the same hands settle through the real double-entry ledger;
 * not one line of room code changes.
 *
 * Conservation: every chip a loser gives up lands on a winner or in a sink (rake / jackpot pools),
 * so `ledger.totalChips() + bank.sinkTotal()` is invariant across any number of hands.
 */
export class ChipBank implements FinancialCoreClient {
  /** Rake and jackpot pools, keyed by the account the settlement addressed them to. */
  private readonly sinks = new Map<string, number>();
  /** Round ids already applied — settlement is idempotent on retry. */
  private readonly settled = new Set<string>();

  constructor(private readonly ledger: ChipLedger) {}

  async buyIn(playerAccountId: string, amount: string): Promise<void> {
    this.ledger.lock(playerAccountId, toChips(amount));
  }

  async release(playerAccountId: string, amount: string): Promise<void> {
    this.ledger.unlock(playerAccountId, toChips(amount));
  }

  async settleTableHand(req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> {
    if (this.settled.has(req.roundId)) return { roundId: req.roundId, applied: false };

    // Losers first: the chips must exist before anyone is paid out of them.
    for (const loser of req.losers) this.ledger.adjustLocked(loser.playerAccountId, -toChips(loser.amount));
    for (const winner of req.winners) this.ledger.adjustLocked(winner.playerAccountId, toChips(winner.amount));

    this.toSink('rake', toChips(req.rake));
    this.toSink(req.jackpotAccounts.mini, toChips(req.jackpot.mini));
    this.toSink(req.jackpotAccounts.minor, toChips(req.jackpot.minor));
    this.toSink(req.jackpotAccounts.major, toChips(req.jackpot.major));
    this.toSink(req.jackpotAccounts.grand, toChips(req.jackpot.grand));

    this.settled.add(req.roundId);
    return { roundId: req.roundId, applied: true };
  }

  async settleRound(req: SettleRoundRequest): Promise<SettlementReceipt> {
    this.ledger.adjustLocked(req.winnerAccountId, toChips(req.winnerProfit));
    this.toSink('rake', toChips(req.rake));
    return {
      roundId: req.roundId,
      sequence: ['jackpot', 'rake', 'payout'],
      amounts: { jackpot: '0', rake: req.rake, payout: req.winnerProfit },
      accounts: { winner: req.winnerAccountId },
      hash: '',
    };
  }

  /** What the house has taken: rake plus each jackpot pool. */
  sinkBalances(): Record<string, number> {
    return Object.fromEntries(this.sinks);
  }

  sinkTotal(): number {
    return [...this.sinks.values()].reduce((sum, n) => sum + n, 0);
  }

  private toSink(account: string, amount: number): void {
    if (amount <= 0) return;
    this.sinks.set(account, (this.sinks.get(account) ?? 0) + amount);
  }
}

/** Financial Core amounts travel as decimal strings; table chips are integers. */
function toChips(amount: string): number {
  const chips = Number(amount);
  if (!Number.isInteger(chips) || chips < 0) throw new Error(`bad settlement amount: ${amount}`);
  return chips;
}
