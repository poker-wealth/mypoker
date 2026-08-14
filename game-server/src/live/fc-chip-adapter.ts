import type {
  FinancialCoreClient,
  InsuranceReserveFacts,
  JackpotPayoutRequest,
  SettleRoundRequest,
  SettlementReceipt,
  TableSettlementRequest,
} from '../core/financial-core-client';
import { chipsToUsdt } from './chip-currency';

/**
 * Wraps a real `FinancialCoreClient` so the room keeps speaking chips while the ledger receives USDT.
 *
 * Every amount the room sends is an integer chip count; the FC contract is USDT decimal strings.
 * This adapter converts each amount field (buy-in, release, settlement stakes, rake, jackpot,
 * jackpot payout) at exactly one boundary — `chip-currency.ts`. Account ids, round ids, table type
 * and league id pass through untouched. Swap `ChipBank` for `new ChipDenominatedFc(httpClient)` and
 * not one line of room, game, or settlement code changes.
 */
export class ChipDenominatedFc implements FinancialCoreClient {
  constructor(private readonly inner: FinancialCoreClient) {}

  buyIn(playerAccountId: string, amount: string): Promise<void> {
    return this.inner.buyIn(playerAccountId, chipsToUsdt(amount));
  }

  release(playerAccountId: string, amount: string): Promise<void> {
    return this.inner.release(playerAccountId, chipsToUsdt(amount));
  }

  settleRound(req: SettleRoundRequest): Promise<SettlementReceipt> {
    return this.inner.settleRound({
      ...req,
      winnerProfit: chipsToUsdt(req.winnerProfit),
      rake: chipsToUsdt(req.rake),
    });
  }

  settleTableHand(req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> {
    return this.inner.settleTableHand({
      ...req,
      losers: req.losers.map((p) => ({ ...p, amount: chipsToUsdt(p.amount) })),
      winners: req.winners.map((p) => ({ ...p, amount: chipsToUsdt(p.amount) })),
      rake: chipsToUsdt(req.rake),
      jackpot: {
        mini: chipsToUsdt(req.jackpot.mini),
        minor: chipsToUsdt(req.jackpot.minor),
        major: chipsToUsdt(req.jackpot.major),
        grand: chipsToUsdt(req.jackpot.grand),
      },
    });
  }

  jackpotPayout(req: JackpotPayoutRequest): Promise<{ applied: boolean }> {
    if (!this.inner.jackpotPayout) return Promise.resolve({ applied: false });
    return this.inner.jackpotPayout({ ...req, amount: chipsToUsdt(req.amount) });
  }

  insuranceReserve(ownerId: string): Promise<InsuranceReserveFacts> {
    // A client that cannot report the reserve reports EMPTY, never a guess. Zero
    // is below §4's threshold, so the underwriter declines and no offer is made
    // — the safe end of the only two ways this can be wrong. Inventing a balance
    // here would let the platform underwrite more than it holds.
    if (!this.inner.insuranceReserve) {
      return Promise.resolve({ ownerId, insuranceBalance: '0', reinsuranceBalance: '0', todayPaidOut: '0' });
    }
    // Passed through as the USDT decimal strings financial-core returns; the room
    // converts to chips at the point of use (`chipsFromUsd`). Converting here as
    // well would double-apply the rate.
    return this.inner.insuranceReserve(ownerId);
  }
}
