import { Money } from '../../src/domain/money';
import { AccountType, LedgerType } from '../../src/domain/account-types';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { LeagueModel } from '../../src/league/league-store';
import { LeagueFundingModel } from '../../src/league/league-funding.model';
import {
  requestTopUp,
  requestCashOut,
  approveLeagueFunding,
  rejectLeagueFunding,
  executeLeagueFunding,
  leagueInventoryId,
  LeagueFundingError,
  CASHOUT_COOLDOWN_MS,
} from '../../src/league/league-funding';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * [money] League top-up and cash-out (12-week plan, W10).
 *
 * These ledger types and clearing paths existed from the beginning with nothing
 * performing them — the same shape as the ₮10k rule the docs also described as
 * already enforced. What matters here is that money moves only at execution,
 * that a large top-up needs two people, and that the cash-out cooldown cannot
 * be walked around.
 */

const LEAGUE = 'league-macau';

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(AccountModel, LedgerModel, LeagueFundingModel);
});
afterAll(stopTestDb);
afterEach(clearCollections);

async function setup(treasury = '100000'): Promise<string> {
  await LeagueModel.create({ _id: LEAGUE, name: 'Macau', ownerId: 'owner-1' });
  const t = await AccountModel.create({
    accountType: AccountType.TREASURY,
    ownerId: 'PLATFORM',
    availableBalance: Money.fromDecimalString(treasury).toDecimal128(),
  });
  return t._id;
}

const inventoryBalance = async (): Promise<string> => {
  const a = await AccountModel.findById(leagueInventoryId(LEAGUE));
  return a ? Money.fromDecimal128(a.availableBalance).toString() : '0.000000';
};

describe('[money] top-up', () => {
  it('moves nothing when merely requested', async () => {
    const treasury = await setup();
    await requestTopUp({ leagueId: LEAGUE, amount: Money.fromDecimalString('500'), requestedBy: 'admin-1' });

    // The whole point of a request: ops has not yet confirmed the TRC-20
    // arrived, so crediting now would be paying against a receipt nobody read.
    expect(await inventoryBalance()).toBe('0.000000');
    const t = await AccountModel.findById(treasury);
    expect(Money.fromDecimal128(t!.availableBalance).toString()).toBe('100000.000000');
  });

  it('moves nothing when merely approved', async () => {
    const treasury = await setup();
    const id = await requestTopUp({ leagueId: LEAGUE, amount: Money.fromDecimalString('500'), requestedBy: 'admin-1' });
    await approveLeagueFunding(id, 'ops-alice');

    expect(await inventoryBalance()).toBe('0.000000');
    await executeLeagueFunding(id, treasury);
    expect(await inventoryBalance()).toBe('500.000000');
  });

  it('credits the league and debits the treasury on execution', async () => {
    const treasury = await setup();
    const id = await requestTopUp({ leagueId: LEAGUE, amount: Money.fromDecimalString('500'), requestedBy: 'admin-1' });
    await approveLeagueFunding(id, 'ops-alice');
    await executeLeagueFunding(id, treasury);

    expect(await inventoryBalance()).toBe('500.000000');
    const t = await AccountModel.findById(treasury);
    expect(Money.fromDecimal128(t!.availableBalance).toString()).toBe('99500.000000');
    expect(await LedgerModel.countDocuments({ type: LedgerType.LEAGUE_TOPUP })).toBe(2);
  });

  it('needs a SECOND person above the threshold', async () => {
    const treasury = await setup();
    const id = await requestTopUp({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('25000'),
      requestedBy: 'admin-1',
    });

    const first = await approveLeagueFunding(id, 'ops-alice');
    expect(first.applied).toBe(false);
    expect(first.awaitingSecondApproval).toBe(true);
    await expect(executeLeagueFunding(id, treasury)).rejects.toThrow(LeagueFundingError);

    const second = await approveLeagueFunding(id, 'ops-bob');
    expect(second.applied).toBe(true);
    await executeLeagueFunding(id, treasury);
    expect(await inventoryBalance()).toBe('25000.000000');
  });

  it('does not let one person approve twice to reach two', async () => {
    await setup();
    const id = await requestTopUp({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('25000'),
      requestedBy: 'admin-1',
    });

    await approveLeagueFunding(id, 'ops-alice');
    const again = await approveLeagueFunding(id, 'ops-alice');
    expect(again.applied).toBe(false);
    expect(again.approvals).toEqual(['ops-alice']);
  });

  it('cannot be executed twice', async () => {
    const treasury = await setup();
    const id = await requestTopUp({ leagueId: LEAGUE, amount: Money.fromDecimalString('500'), requestedBy: 'admin-1' });
    await approveLeagueFunding(id, 'ops-alice');
    await executeLeagueFunding(id, treasury);

    // Terminal after the first, so a retried click cannot fund a league twice.
    await expect(executeLeagueFunding(id, treasury)).rejects.toThrow(LeagueFundingError);
    expect(await inventoryBalance()).toBe('500.000000');
  });
});

describe('[money] cash-out', () => {
  /** Fund the league so there is something to cash out. */
  const fund = async (treasury: string, amount: string): Promise<void> => {
    const id = await requestTopUp({ leagueId: LEAGUE, amount: Money.fromDecimalString(amount), requestedBy: 'admin-1' });
    // A second signature is only needed above the threshold — approving twice
    // below it fails, because the first approval has already moved the state.
    const first = await approveLeagueFunding(id, 'ops-alice');
    if (!first.applied) await approveLeagueFunding(id, 'ops-bob');
    await executeLeagueFunding(id, treasury);
  };

  it('drains the league inventory back to the treasury', async () => {
    const treasury = await setup();
    await fund(treasury, '5000');

    const id = await requestCashOut({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('2000'),
      requestedBy: 'admin-1',
      address: 'TJmVfB9Xk2QpLr4NwZc7HdGyE5sT8uV1aB',
    });
    await approveLeagueFunding(id, 'ops-alice');
    await executeLeagueFunding(id, treasury);

    expect(await inventoryBalance()).toBe('3000.000000');
    expect(await LedgerModel.countDocuments({ type: LedgerType.LEAGUE_CASHOUT })).toBe(2);
  });

  it('cannot drain more than the league holds', async () => {
    const treasury = await setup();
    await fund(treasury, '1000');

    const id = await requestCashOut({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('5000'),
      requestedBy: 'admin-1',
      address: 'TJmV',
    });
    await approveLeagueFunding(id, 'ops-alice');

    // Checked at EXECUTION, not at request: the balance may have been spent on
    // table winnings in between, and §3.1 gives the league no platform backstop.
    await expect(executeLeagueFunding(id, treasury)).rejects.toThrow();
    expect(await inventoryBalance()).toBe('1000.000000');
  });

  it('enforces the 24-hour cooldown between requests', async () => {
    await setup();
    await requestCashOut({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('10'),
      requestedBy: 'admin-1',
      address: 'TJmV',
    });

    await expect(
      requestCashOut({
        leagueId: LEAGUE,
        amount: Money.fromDecimalString('10'),
        requestedBy: 'admin-1',
        address: 'TJmV',
      }),
    ).rejects.toThrow(/cooldown/);
  });

  it('counts a REJECTED request against the cooldown', async () => {
    // Otherwise the cooldown is defeated by asking for something certain to be
    // refused, then immediately asking again.
    await setup();
    const id = await requestCashOut({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('10'),
      requestedBy: 'admin-1',
      address: 'TJmV',
    });
    await rejectLeagueFunding(id, 'ops-alice', 'no');

    await expect(
      requestCashOut({
        leagueId: LEAGUE,
        amount: Money.fromDecimalString('10'),
        requestedBy: 'admin-1',
        address: 'TJmV',
      }),
    ).rejects.toThrow(/cooldown/);
  });

  it('allows a request once the cooldown has passed', async () => {
    await setup();
    const past = new Date(Date.now() - CASHOUT_COOLDOWN_MS - 60_000);
    await LeagueFundingModel.create({
      leagueId: LEAGUE,
      kind: 'CASHOUT',
      amount: Money.fromDecimalString('10').toDecimal128(),
      state: 'EXECUTED',
      requestedBy: 'admin-1',
      createdAt: past,
      updatedAt: past,
    });

    await expect(
      requestCashOut({
        leagueId: LEAGUE,
        amount: Money.fromDecimalString('10'),
        requestedBy: 'admin-1',
        address: 'TJmV',
      }),
    ).resolves.toBeTruthy();
  });

  it('refuses a cash-out with no payout address', async () => {
    await setup();
    await expect(
      requestCashOut({
        leagueId: LEAGUE,
        amount: Money.fromDecimalString('10'),
        requestedBy: 'admin-1',
        address: '',
      }),
    ).rejects.toThrow(/address/);
  });

  it('does NOT require a second signature — the spec asks for review, not two', async () => {
    const treasury = await setup();
    await fund(treasury, '50000');

    const id = await requestCashOut({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('30000'),
      requestedBy: 'admin-1',
      address: 'TJmV',
    });
    // A cash-out returns a league's OWN money. The threshold guards platform
    // funds leaving the treasury, which is the top-up direction.
    expect((await approveLeagueFunding(id, 'ops-alice')).applied).toBe(true);
  });
});

describe('[money] rejection', () => {
  it('keeps a refused request as a record and moves nothing', async () => {
    const treasury = await setup();
    const id = await requestTopUp({ leagueId: LEAGUE, amount: Money.fromDecimalString('500'), requestedBy: 'admin-1' });
    await rejectLeagueFunding(id, 'ops-alice', 'no TRC-20 receipt found');

    const doc = await LeagueFundingModel.findById(id).lean();
    expect(doc!.state).toBe('REJECTED');
    expect(doc!.rejectionReason).toBe('no TRC-20 receipt found');
    await expect(executeLeagueFunding(id, treasury)).rejects.toThrow(LeagueFundingError);
    expect(await inventoryBalance()).toBe('0.000000');
  });

  it('can reject something already approved', async () => {
    // Ops who signed off and then learned the receipt never arrived must be
    // able to stop it before execution.
    await setup();
    const id = await requestTopUp({ leagueId: LEAGUE, amount: Money.fromDecimalString('500'), requestedBy: 'admin-1' });
    await approveLeagueFunding(id, 'ops-alice');
    await expect(rejectLeagueFunding(id, 'ops-bob', 'receipt was wrong')).resolves.toBeUndefined();
  });
});
