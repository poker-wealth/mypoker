import type {
  FinancialCoreClient,
  InsuranceReserveFacts,
  JackpotAnomalyReport,
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

  reportJackpotAnomaly(req: JackpotAnomalyReport): Promise<void> {
    // No money, no units — tableId + a count. Straight pass-through (no-op if the inner client,
    // e.g. a demo fake, has no CB3 endpoint).
    if (!this.inner.reportJackpotAnomaly) return Promise.resolve();
    return this.inner.reportJackpotAnomaly(req);
  }

  insuranceReserve(ownerId: string): Promise<InsuranceReserveFacts> {
    if (!this.inner.insuranceReserve) {
      return Promise.resolve({ ownerId, insuranceBalance: '0', reinsuranceBalance: '0', todayPaidOut: '0' });
    }
    // Insurance money is not wired for real until Day 5. These facts are USDT decimals and are read
    // only by the placeholder insurance offer, which moves no money — so they pass through as-is and
    // get chip-converted when the insurance premium/payout paths land.
    return this.inner.insuranceReserve(ownerId);
  }
}
