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
 * that a large movement in EITHER direction needs two people, and that the
 * cash-out cooldown cannot be walked around.
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
    await executeLeagueFunding(id, treasury, 'ops-exec');
    expect(await inventoryBalance()).toBe('500.000000');
  });

  it('credits the league and debits the treasury on execution', async () => {
    const treasury = await setup();
    const id = await requestTopUp({ leagueId: LEAGUE, amount: Money.fromDecimalString('500'), requestedBy: 'admin-1' });
    await approveLeagueFunding(id, 'ops-alice');
    await executeLeagueFunding(id, treasury, 'ops-exec');

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
    await expect(executeLeagueFunding(id, treasury, 'ops-exec')).rejects.toThrow(LeagueFundingError);

    const second = await approveLeagueFunding(id, 'ops-bob');
    expect(second.applied).toBe(true);
    await executeLeagueFunding(id, treasury, 'ops-exec');
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
    await executeLeagueFunding(id, treasury, 'ops-exec');

    // Terminal after the first, so a retried click cannot fund a league twice.
    await expect(executeLeagueFunding(id, treasury, 'ops-exec')).rejects.toThrow(LeagueFundingError);
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
    await executeLeagueFunding(id, treasury, 'ops-exec');
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
    await executeLeagueFunding(id, treasury, 'ops-exec');

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
    await expect(executeLeagueFunding(id, treasury, 'ops-exec')).rejects.toThrow();
    expect(await inventoryBalance()).toBe('1000.000000');
  });

  it('hands the claim back when the transfer fails, so the request is not stranded', async () => {
    const treasury = await setup();
    await fund(treasury, '1000');

    const id = await requestCashOut({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('5000'), // more than the league holds
      requestedBy: 'admin-1',
      address: 'TJmV',
    });
    await approveLeagueFunding(id, 'ops-alice');
    await expect(executeLeagueFunding(id, treasury, 'ops-exec')).rejects.toThrow();

    // Overdraft refused → state returns to APPROVED, where it can be retried
    // after the inventory recovers, or rejected outright.
    const doc = await LeagueFundingModel.findById(id).lean();
    expect(doc!.state).toBe('APPROVED');
    await expect(rejectLeagueFunding(id, 'ops-bob', 'league cannot cover it')).resolves.toBeUndefined();
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

  it('needs a SECOND person above the threshold, same as a top-up', async () => {
    const treasury = await setup();
    await fund(treasury, '50000');

    const id = await requestCashOut({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('30000'),
      requestedBy: 'admin-1',
      address: 'TJmV',
    });
    // W10 deliverables: "league top-up AND cash-out workflow with second-person
    // confirmation"; §11.2: "All admin actions require second ops person
    // approval." A cash-out is the league's own money, but it leaves the
    // platform for an address someone typed — one person alone must not be able
    // to send ₮30,000 anywhere.
    const first = await approveLeagueFunding(id, 'ops-alice');
    expect(first.applied).toBe(false);
    expect(first.awaitingSecondApproval).toBe(true);
    await expect(executeLeagueFunding(id, treasury, 'ops-exec')).rejects.toThrow(
      LeagueFundingError,
    );

    expect((await approveLeagueFunding(id, 'ops-bob')).applied).toBe(true);
    await executeLeagueFunding(id, treasury, 'ops-exec');
    expect(await inventoryBalance()).toBe('20000.000000');
  });

  it('still takes ONE signature at or below the threshold', async () => {
    const treasury = await setup();
    await fund(treasury, '5000');

    const id = await requestCashOut({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('2000'),
      requestedBy: 'admin-1',
      address: 'TJmV',
    });
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
    await expect(executeLeagueFunding(id, treasury, 'ops-exec')).rejects.toThrow(LeagueFundingError);
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

  it('a rejection arriving BEFORE the approval simply wins', async () => {
    // The easy interleaving: state is already REJECTED when approve starts, so
    // the signature write itself finds nothing to sign.
    await setup();
    const id = await requestTopUp({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('25000'),
      requestedBy: 'admin-1',
    });
    await approveLeagueFunding(id, 'ops-alice');
    await rejectLeagueFunding(id, 'ops-carol', 'no TRC-20 receipt found');
    await expect(approveLeagueFunding(id, 'ops-bob')).rejects.toThrow(/not awaiting/);
  });

  it('cannot resurrect a REJECTED request — a rejection landing MID-approval stands', async () => {
    // THE RACE THIS AUDIT FOUND. Approve records the signature while the state
    // is still REQUESTED; the rejection lands; approve's final write used to be
    // an unconditional $set that flipped REJECTED back to APPROVED — after
    // which /execute would move money an ops person explicitly stopped.
    //
    // The rejection is injected into the exact window: after the signature
    // write completes, before the promote runs.
    const treasury = await setup();
    const id = await requestTopUp({
      leagueId: LEAGUE,
      amount: Money.fromDecimalString('500'), // one signature suffices — the window is the same
      requestedBy: 'admin-1',
    });

    const original = LeagueFundingModel.findOneAndUpdate.bind(LeagueFundingModel);
    const spy = jest.spyOn(LeagueFundingModel, 'findOneAndUpdate').mockImplementationOnce(
      ((...args: Parameters<typeof original>) =>
        (async () => {
          const doc = await original(...args); // the real $addToSet, state still REQUESTED
          await rejectLeagueFunding(id, 'ops-carol', 'no TRC-20 receipt found');
          return doc;
        })()) as unknown as typeof original,
    );
    try {
      await expect(approveLeagueFunding(id, 'ops-alice')).rejects.toThrow(/REJECTED/);
    } finally {
      spy.mockRestore();
    }

    const doc = await LeagueFundingModel.findById(id).lean();
    expect(doc!.state).toBe('REJECTED');
    await expect(executeLeagueFunding(id, treasury, 'ops-exec')).rejects.toThrow(
      LeagueFundingError,
    );
    expect(await inventoryBalance()).toBe('0.000000');
  });

  it('cannot reject once execution has claimed the request', async () => {
    // Past the claim the transfer may already be in the ledger; a rejection
    // that pretended to stop it would lie in the audit trail. Too late is the
    // correct answer.
    await setup();
    const id = await requestTopUp({ leagueId: LEAGUE, amount: Money.fromDecimalString('500'), requestedBy: 'admin-1' });
    await approveLeagueFunding(id, 'ops-alice');
    await LeagueFundingModel.updateOne({ _id: id }, { $set: { state: 'EXECUTING' } });

    await expect(rejectLeagueFunding(id, 'ops-bob', 'too late')).rejects.toThrow(
      /cannot be rejected/,
    );
  });

  it('records WHO executed', async () => {
    const treasury = await setup();
    const id = await requestTopUp({ leagueId: LEAGUE, amount: Money.fromDecimalString('500'), requestedBy: 'admin-1' });
    await approveLeagueFunding(id, 'ops-alice');
    await executeLeagueFunding(id, treasury, 'ops-dave');

    const doc = await LeagueFundingModel.findById(id).lean();
    expect(doc!.state).toBe('EXECUTED');
    expect(doc!.executedBy).toBe('ops-dave');
  });
});
