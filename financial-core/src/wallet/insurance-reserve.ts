import { Money } from '../domain/money';
import {
  evaluateCB1,
  evaluateCB2,
  CB1_PLATFORM_THRESHOLD,
  CB1_LEAGUE_THRESHOLD,
} from '../circuit-breakers/breakers';
import { LedgerType, LedgerDirection } from '../domain/account-types';
import { AccountModel } from './account.model';
import { LedgerModel } from './ledger.model';
import {
  ensureInsuranceAccounts,
  insuranceAccountId,
  reinsuranceAccountId,
} from './system-accounts';

/**
 * Insurance reserve FACTS for one system — `PLATFORM` or a leagueId (§4).
 *
 * Facts only: balances and today's outflow. The rules that make them mean
 * something — the $10k/$1k health threshold, the 5% single-payout cap, the 15%
 * daily budget — live with the underwriting engine in the gateway
 * (game-server/src/games/texas/underwriting.ts), which is this module's only
 * consumer. Restating the caps here would give two answers to how much the
 * pool may risk.
 *
 * Today's outflow is read from the LEDGER, not a counter: a crashed process
 * cannot forget what it already paid, and the daily cap is only as honest as
 * the number it is checked against.
 */
export interface InsuranceReserveFacts {
  ownerId: string;
  /** Decimal strings, USD — the FC wire format for money. */
  insuranceBalance: string;
  reinsuranceBalance: string;
  todayPaidOut: string;
}

export async function getInsuranceReserve(ownerId: string): Promise<InsuranceReserveFacts> {
  await ensureInsuranceAccounts(ownerId);

  const [insurance, reinsurance] = await Promise.all([
    AccountModel.findById(insuranceAccountId(ownerId)).lean(),
    AccountModel.findById(reinsuranceAccountId(ownerId)).lean(),
  ]);

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const paidRows = await LedgerModel.find({
    accountId: insuranceAccountId(ownerId),
    type: LedgerType.INSURANCE_PAYOUT,
    direction: LedgerDirection.DEBIT,
    createdAt: { $gte: startOfDay },
  }).lean();

  // Summed with Money, not $toDouble in an aggregation — iron rule 7 applies
  // to limit arithmetic as much as to transfers; this figure feeds a cap.
  const todayPaidOut = Money.sum(paidRows.map((row) => Money.fromDecimal128(row.amount)));

  // CB1 and CB2 (§3.8) evaluate here because this read IS their data feed —
  // the registry carried "logic complete; fires once insurance data feeds
  // land" until this line. Every reserve poll (each room, every ~15s) now
  // checks pool level and daily payout rate, logging and alerting on a trip.
  // The QUOTE-side consequence is enforced by the caller either way: a
  // below-threshold reserve produces no offers whether or not anyone reads
  // the alert.
  const balance = insurance ? Money.fromDecimal128(insurance.availableBalance) : Money.ZERO;
  const threshold = ownerId === 'PLATFORM' ? CB1_PLATFORM_THRESHOLD : CB1_LEAGUE_THRESHOLD;
  await evaluateCB1(balance, threshold);
  await evaluateCB2(todayPaidOut, balance);

  return {
    ownerId,
    insuranceBalance: insurance
      ? Money.fromDecimal128(insurance.availableBalance).toString()
      : '0.000000',
    reinsuranceBalance: reinsurance
      ? Money.fromDecimal128(reinsurance.availableBalance).toString()
      : '0.000000',
    todayPaidOut: todayPaidOut.toString(),
  };
}
