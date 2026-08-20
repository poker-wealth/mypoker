import { AccountType, LedgerType } from '../../src/domain/account-types';
import { Money } from '../../src/domain/money';
import { AccountModel } from '../../src/wallet/account.model';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { LeagueModel } from '../../src/league/league-store';
import { leagueInventoryId } from '../../src/league/league-funding';
import { grantToMember, LeagueGrantError } from '../../src/league/league-grant';
import { getOrCreatePlayerAccount } from '../../src/wallet/system-accounts';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * [money] League grants — a league funding its own member's league wallet.
 *
 * The league economy had an on-ramp (TREASURY → LEAGUE_INVENTORY) and an
 * off-ramp, but nothing reached a player: deposits credit the PLATFORM wallet
 * while a league buy-in resolves a league-SCOPED account, so a member's league
 * wallet was permanently empty and league tables could never be sat at. This is
 * the missing middle, and what it must never do is leak league money into the
 * open economy — where it could be withdrawn.
 */

const LEAGUE = 'league-macau';
const MEMBER = 'player-1';

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(AccountModel, LedgerModel);
});
afterAll(stopTestDb);
afterEach(clearCollections);

/** A league with a funded inventory, as a top-up would leave it. */
async function fundedLeague(inventory = '1000'): Promise<void> {
  await LeagueModel.create({ _id: LEAGUE, name: 'Macau', ownerId: 'owner-1' });
  await AccountModel.create({
    _id: leagueInventoryId(LEAGUE),
    accountType: AccountType.LEAGUE_INVENTORY,
    ownerId: LEAGUE,
    availableBalance: Money.fromDecimalString(inventory).toDecimal128(),
  });
}

const grant = (amount: string, over: Partial<Parameters<typeof grantToMember>[0]> = {}) =>
  grantToMember({
    leagueId: LEAGUE,
    playerId: MEMBER,
    amount: Money.fromDecimalString(amount),
    grantedBy: 'owner-1',
    ...over,
  });

describe('[money] a league grants chips to a member', () => {
  it('moves inventory into the member league wallet', async () => {
    await fundedLeague('1000');
    const res = await grant('250');

    expect(res.applied).toBe(true);
    const inv = await AccountModel.findById(leagueInventoryId(LEAGUE)).lean();
    expect(Money.fromDecimal128(inv!.availableBalance).toString()).toBe('750.000000');

    const wallet = await getOrCreatePlayerAccount(MEMBER, LEAGUE);
    expect(Money.fromDecimal128(wallet.availableBalance).toString()).toBe('250.000000');
  });

  it('credits the LEAGUE wallet, never the platform one', async () => {
    // The isolation the spec calls a "critical isolation failure" if broken:
    // league money in a platform wallet could be withdrawn to real funds.
    await fundedLeague();
    await grant('100');

    const platform = await getOrCreatePlayerAccount(MEMBER);
    expect(Money.fromDecimal128(platform.availableBalance).toString()).toBe('0.000000');
    expect(platform.scope).not.toBe(LEAGUE);
  });

  it('writes a LEAGUE_GRANT double entry naming the granter', async () => {
    await fundedLeague();
    const res = await grant('100', { grantedBy: 'admin-7' });

    const entries = await LedgerModel.find({ type: LedgerType.LEAGUE_GRANT }).lean();
    expect(entries).toHaveLength(2); // a transfer is a balanced pair
    expect(entries.every((e) => e.idempotencyKey === `league:grant:${res.grantId}`)).toBe(true);
    expect(entries[0]!.metadata).toMatchObject({ leagueId: LEAGUE, grantedBy: 'admin-7' });
  });

  it('is idempotent on its reference — a retry does not pay twice', async () => {
    await fundedLeague('1000');
    await grant('100', { reference: 'grant-abc' });
    await grant('100', { reference: 'grant-abc' });

    const inv = await AccountModel.findById(leagueInventoryId(LEAGUE)).lean();
    expect(Money.fromDecimal128(inv!.availableBalance).toString()).toBe('900.000000');
  });
});

describe('[money] a grant refuses rather than inventing money', () => {
  it('cannot exceed the inventory', async () => {
    await fundedLeague('50');
    await expect(grant('51')).rejects.toThrow();

    const wallet = await getOrCreatePlayerAccount(MEMBER, LEAGUE);
    expect(Money.fromDecimal128(wallet.availableBalance).toString()).toBe('0.000000');
  });

  it('refuses a league that has never been funded', async () => {
    // Get-or-create here would turn "this league has no money" into a confusing
    // overdraft one layer down, and would leave an empty inventory behind.
    await LeagueModel.create({ _id: LEAGUE, name: 'Macau', ownerId: 'owner-1' });
    await expect(grant('10')).rejects.toThrow(LeagueGrantError);
  });

  it.each([['0'], ['-5']])('refuses a non-positive amount (%s)', async (amount) => {
    await fundedLeague();
    await expect(grant(amount)).rejects.toThrow(LeagueGrantError);
  });

  it('requires a named granter', async () => {
    await fundedLeague();
    await expect(grant('10', { grantedBy: '' })).rejects.toThrow(LeagueGrantError);
  });
});

describe('[money] the league total is conserved', () => {
  it('a grant moves money inside the league, it does not create any', async () => {
    await fundedLeague('1000');
    await grant('400');

    const inv = await AccountModel.findById(leagueInventoryId(LEAGUE)).lean();
    const wallet = await getOrCreatePlayerAccount(MEMBER, LEAGUE);
    const total =
      Money.fromDecimal128(inv!.availableBalance).toMicros() +
      Money.fromDecimal128(wallet.availableBalance).toMicros();

    expect(total).toBe(Money.fromDecimalString('1000').toMicros());
  });
});
