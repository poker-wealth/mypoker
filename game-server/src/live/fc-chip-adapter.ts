import type {
  FinancialCoreClient,
  InsuranceReserveFacts,
  JackpotAnomalyReport,
  JackpotPayoutRequest,
  SettleRoundRequest,
  SettlementReceipt,
  SettlementStatus,
  TableSettlementRequest,
  WalletScope,
} from '../core/financial-core-client';
import { chipsToUsdt, usdtToChips } from './chip-currency';

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
  /**
   * Declared as an optional PROPERTY, not a prototype method, so it can be left entirely unset
   * below (BUG-10 follow-up B). `FinancialCoreClient.lockedBalance` is documented as: absent means
   * the caller should treat "locked" as UNKNOWN, never as zero. A method that always exists and
   * quietly returns '0' when the inner client can't answer breaks that contract for anyone reading
   * `fc.lockedBalance` as a presence check (slots-room's `fundVendor` does exactly that) — they'd
   * see a real function and trust its lying zero instead of falling back to their own tracking.
   */
  lockedBalance?: (playerAccountId: string, scope?: WalletScope) => Promise<string>;

  /**
   * Same optional-property shape as `lockedBalance` above, and for the same reason (BUG-20): absent
   * means the caller (settlement-recovery's `confirmSettled`) should treat a lost response as
   * unconfirmable, never as a silent "can't have happened".
   */
  settlementStatus?: (roundId: string) => Promise<SettlementStatus>;

  constructor(private readonly inner: FinancialCoreClient) {
    if (inner.lockedBalance) {
      const innerLockedBalance = inner.lockedBalance.bind(inner);
      this.lockedBalance = async (playerAccountId: string, scope?: WalletScope): Promise<string> => {
        const usdt = await innerLockedBalance(playerAccountId, scope);
        // The inner client (the real ledger) speaks USDT; the room speaks chips — convert at this
        // same boundary every other amount crosses, just in the read direction.
        return String(usdtToChips(usdt));
      };
    }
    if (inner.settlementStatus) {
      const innerSettlementStatus = inner.settlementStatus.bind(inner);
      this.settlementStatus = async (roundId: string): Promise<SettlementStatus> => {
        const status = await innerSettlementStatus(roundId);
        if (!status.settled || !status.receipt) return status;
        const r = status.receipt;
        return {
          settled: true,
          receipt: {
            ...r,
            rake: String(usdtToChips(r.rake)),
            jackpotTotal: String(usdtToChips(r.jackpotTotal)),
            losers: r.losers.map((p) => ({ ...p, amount: String(usdtToChips(p.amount)) })),
            winners: r.winners.map((p) => ({ ...p, amount: String(usdtToChips(p.amount)) })),
          },
        };
      };
    }
  }

  buyIn(playerAccountId: string, amount: string, scope?: WalletScope): Promise<void> {
    return this.inner.buyIn(playerAccountId, chipsToUsdt(amount), scope);
  }

  release(playerAccountId: string, amount: string, scope?: WalletScope): Promise<void> {
    return this.inner.release(playerAccountId, chipsToUsdt(amount), scope);
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
