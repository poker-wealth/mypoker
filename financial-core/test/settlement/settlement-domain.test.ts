import { getRakeDestination, TableType } from '../../src/settlement/settlement-domain';
import { AccountType } from '../../src/domain/account-types';

describe('Settlement Domain — rake routing', () => {
  it('routes platform-table rake to the platform TREASURY', () => {
    expect(getRakeDestination(TableType.PLATFORM)).toEqual({
      accountType: AccountType.TREASURY,
      ownerId: 'PLATFORM',
    });
  });

  it('routes league-table rake to that league\'s LEAGUE_INVENTORY', () => {
    expect(getRakeDestination(TableType.LEAGUE, 'league-9')).toEqual({
      accountType: AccountType.LEAGUE_INVENTORY,
      ownerId: 'league-9',
    });
  });

  it('requires a leagueId for league tables', () => {
    expect(() => getRakeDestination(TableType.LEAGUE)).toThrow(/leagueId is required/);
  });
});
