import { Decimal128 } from 'bson';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SecurityLogModel } from '../../src/security/security-log.model';
import { SettlementModel } from '../../src/settlement/settlement.model';
import { transfer } from '../../src/wallet/transfer';
import { settleTableHand } from '../../src/settlement/table-settlement';
import { TableType } from '../../src/settlement/settlement-domain';
import { IllegalFundFlowError, InsufficientBalanceError } from '../../src/wallet/errors';
import { AccountType, LedgerType } from '../../src/domain/account-types';
import { Money } from '../../src/domain/money';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * ADVERSARIAL FUND-INTEGRITY SUITE (plan Day 16 — security pen test, money-safety subset).
 *
 * Each test IS an attack: it tries to make the ledger create, misappropriate, or double-spend money,
 * and asserts the platform refuses AND leaves the books untouched. These map to the iron rules
 * (§3.3 clearing whitelist, three-balance overdraft guard, settlement conservation + idempotency,
 * Platform/League isolation). The transport-layer and fairness attack paths from the full spec pen
 * test are out of scope here and need the security doc + a dedicated pass.
 */

const m = (s: string): Money => Money.fromDecimalString(s);
const avail = async (id: string): Promise<string> =>
  Money.fromDecimal128((await AccountModel.findById(id))!.availableBalance).toString();
const locked = async (id: string): Promise<string> =>
  Money.fromDecimal128((await AccountModel.findById(id))!.lockedBalance).toString();

async function mkAccount(type: AccountType, ownerId: string, available = '0', lockedBal = '0'): Promise<string> {
  const a = await AccountModel.create({
    accountType: type,
    ownerId,
    availableBalance: Decimal128.fromString(available),
    lockedBalance: Decimal128.fromString(lockedBal),
  });
  return a._id;
}
async function pools(table: string): Promise<{ mini: string; minor: string; major: string; grand: string }> {
  return {
    mini: await mkAccount(AccountType.JACKPOT_MINI, table),
    minor: await mkAccount(AccountType.JACKPOT_MINOR, table),
    major: await mkAccount(AccountType.JACKPOT_MAJOR, table),
    grand: await mkAccount(AccountType.JACKPOT_GRAND, table),
  };
}

describe('attack paths — the ledger refuses to be robbed', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel, LedgerModel, SecurityLogModel, SettlementModel);
  });
  afterAll(stopTestDb);
  afterEach(clearCollections);

  it('ATTACK 1 — drain a jackpot pool to the treasury (misappropriation): blocked, logged, no move', async () => {
    const jackpot = await mkAccount(AccountType.JACKPOT_MINI, 'table-x', '1000');
    const treasury = await mkAccount(AccountType.TREASURY, 'PLATFORM');

    // JACKPOT_* → TREASURY is off the whitelist by design ("no misappropriation").
    await expect(
      transfer({
        fromAccountId: jackpot,
        toAccountId: treasury,
        amount: m('1000'),
        type: LedgerType.RAKE,
        idempotencyKey: 'attack-1',
      }),
    ).rejects.toBeInstanceOf(IllegalFundFlowError);

    expect(await avail(jackpot)).toBe('1000.000000'); // not a cent moved
    expect(await avail(treasury)).toBe('0.000000');
    expect(await SecurityLogModel.countDocuments({ event: 'ILLEGAL_FUND_FLOW' })).toBe(1);
    expect(await LedgerModel.countDocuments({ idempotencyKey: 'attack-1' })).toBe(0);
  });

  it('ATTACK 2 — a player siphons straight into reinsurance: blocked + logged', async () => {
    const player = await mkAccount(AccountType.PLAYER, 'p', '500');
    const reinsurance = await mkAccount(AccountType.REINSURANCE, 'PLATFORM');

    await expect(
      transfer({
        fromAccountId: player,
        toAccountId: reinsurance,
        amount: m('500'),
        type: LedgerType.RAKE,
        idempotencyKey: 'attack-2',
      }),
    ).rejects.toBeInstanceOf(IllegalFundFlowError);
    expect(await avail(player)).toBe('500.000000');
    expect(await SecurityLogModel.countDocuments({ event: 'ILLEGAL_FUND_FLOW' })).toBe(1);
  });

  it('ATTACK 3 — overdraft: spend more than you hold, on a WHITELISTED path: blocked atomically', async () => {
    const player = await mkAccount(AccountType.PLAYER, 'p', '100');
    const treasury = await mkAccount(AccountType.TREASURY, 'PLATFORM'); // PLAYER→TREASURY is allowed

    await expect(
      transfer({
        fromAccountId: player,
        toAccountId: treasury,
        amount: m('100000'),
        type: LedgerType.RAKE,
        idempotencyKey: 'attack-3',
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);

    // Atomic: neither side moved, no ledger row — a failed debit leaves nothing half-applied.
    expect(await avail(player)).toBe('100.000000');
    expect(await avail(treasury)).toBe('0.000000');
    expect(await LedgerModel.countDocuments({ idempotencyKey: 'attack-3' })).toBe(0);
  });

  it('ATTACK 4 — replay a settlement to get paid twice: applied once, no double credit', async () => {
    const loser = await mkAccount(AccountType.PLAYER, 'L', '0', '1000');
    const winner = await mkAccount(AccountType.PLAYER, 'W', '0', '0');
    await mkAccount(AccountType.TREASURY, 'PLATFORM');
    const jp = await pools('table-4');

    const hand = {
      roundId: 'replay-round',
      tableType: TableType.PLATFORM,
      losers: [{ accountId: loser, amount: m('1000') }],
      winners: [{ accountId: winner, amount: m('950') }],
      rake: m('50'),
      jackpot: { mini: m('0'), minor: m('0'), major: m('0'), grand: m('0') },
      jackpotAccounts: jp,
    };

    expect((await settleTableHand(hand)).applied).toBe(true);
    // The attacker resubmits the exact same settled round.
    expect((await settleTableHand(hand)).applied).toBe(false);

    expect(await locked(winner)).toBe('950.000000'); // credited once, not 1900
    expect(await locked(loser)).toBe('0.000000');
    expect(await SettlementModel.countDocuments({ roundId: 'replay-round' })).toBe(1);
  });

  it('ATTACK 5 — platform-as-banker: pay winners MORE than the pot, house funds the gap: rejected', async () => {
    const loser = await mkAccount(AccountType.PLAYER, 'L', '0', '1000');
    const winner = await mkAccount(AccountType.PLAYER, 'W', '0', '0');
    await mkAccount(AccountType.TREASURY, 'PLATFORM');
    const jp = await pools('table-5');

    // Σ(losers)=1000 but Σ(winners)+rake+jackpot=1200 → the house would have to bank 200.
    await expect(
      settleTableHand({
        roundId: 'banker-round',
        tableType: TableType.PLATFORM,
        losers: [{ accountId: loser, amount: m('1000') }],
        winners: [{ accountId: winner, amount: m('1200') }],
        rake: m('0'),
        jackpot: { mini: m('0'), minor: m('0'), major: m('0'), grand: m('0') },
        jackpotAccounts: jp,
      }),
    ).rejects.toThrow(/not conserved/);

    // Nothing applied: the loser keeps their stake, the winner got nothing, no settlement recorded.
    expect(await locked(loser)).toBe('1000.000000');
    expect(await locked(winner)).toBe('0.000000');
    expect(await SettlementModel.countDocuments({ roundId: 'banker-round' })).toBe(0);
  });

  it('ATTACK 6 — a league hand reaches into the platform treasury: isolation holds', async () => {
    const loser = await mkAccount(AccountType.PLAYER, 'L', '0', '1000');
    const winner = await mkAccount(AccountType.PLAYER, 'W', '0', '0');
    const platformTreasury = await mkAccount(AccountType.TREASURY, 'PLATFORM');
    const leagueInv = await mkAccount(AccountType.LEAGUE_INVENTORY, 'league-1');
    const jp = await pools('table-6');

    const res = await settleTableHand({
      roundId: 'league-round',
      tableType: TableType.LEAGUE,
      leagueId: 'league-1',
      losers: [{ accountId: loser, amount: m('1000') }],
      winners: [{ accountId: winner, amount: m('950') }],
      rake: m('50'),
      jackpot: { mini: m('0'), minor: m('0'), major: m('0'), grand: m('0') },
      jackpotAccounts: jp,
    });
    expect(res.applied).toBe(true);

    expect(await avail(leagueInv)).toBe('50.000000'); // league rake → league inventory
    expect(await avail(platformTreasury)).toBe('0.000000'); // platform treasury NEVER touched
  });
});
