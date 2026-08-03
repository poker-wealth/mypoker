import { isFlowAllowed, ALLOWED_FLOWS } from '../../src/clearing/clearing-rules';
import { AccountType } from '../../src/domain/account-types';

describe('ClearingRules whitelist', () => {
  it('allows player payments into treasury / league / insurance / jackpots', () => {
    expect(isFlowAllowed(AccountType.PLAYER, AccountType.TREASURY)).toBe(true);
    expect(isFlowAllowed(AccountType.PLAYER, AccountType.LEAGUE_INVENTORY)).toBe(true);
    expect(isFlowAllowed(AccountType.PLAYER, AccountType.INSURANCE)).toBe(true);
    expect(isFlowAllowed(AccountType.PLAYER, AccountType.JACKPOT_MINI)).toBe(true);
  });

  it('forbids the spec\'s named prohibited flows', () => {
    expect(isFlowAllowed(AccountType.PLAYER, AccountType.REINSURANCE)).toBe(false); // §3.3
    expect(isFlowAllowed(AccountType.TREASURY, AccountType.INSURANCE)).toBe(false); // multi-sig only
    expect(isFlowAllowed(AccountType.INSURANCE, AccountType.TREASURY)).toBe(false);
    expect(isFlowAllowed(AccountType.REINSURANCE, AccountType.PLAYER)).toBe(false); // must go via INSURANCE
    expect(isFlowAllowed(AccountType.LEAGUE_INVENTORY, AccountType.LEAGUE_INVENTORY)).toBe(false);
    expect(isFlowAllowed(AccountType.JACKPOT_GRAND, AccountType.TREASURY)).toBe(false); // no misappropriation
  });

  it('makes jackpot pools pay-out-only (to players)', () => {
    for (const j of [
      AccountType.JACKPOT_MINI,
      AccountType.JACKPOT_MINOR,
      AccountType.JACKPOT_MAJOR,
      AccountType.JACKPOT_GRAND,
    ]) {
      expect(ALLOWED_FLOWS[j]).toEqual([AccountType.PLAYER]);
    }
  });

  it('treats unknown/no-rule sources as denied by default', () => {
    expect(isFlowAllowed(AccountType.TREASURY, AccountType.JACKPOT_MINI)).toBe(false);
  });
});
