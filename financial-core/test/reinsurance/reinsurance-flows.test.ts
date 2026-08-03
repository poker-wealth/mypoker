import { isFlowAllowed } from '../../src/clearing/clearing-rules';
import { AccountType } from '../../src/domain/account-types';

/**
 * The reinsurance pool is the last line of defence behind insurance. The one thing that must be
 * structurally impossible is money walking OUT of it to a person — that is what looting a backstop
 * looks like. CB6 (the clearing whitelist) is what makes it impossible, so it is worth proving.
 */

describe('CB6 whitelist — the reinsurance backstop cannot be looted', () => {
  it('REINSURANCE can never pay a PLAYER directly', () => {
    expect(isFlowAllowed(AccountType.REINSURANCE, AccountType.PLAYER)).toBe(false);
  });

  it('REINSURANCE can never reach an EXTERNAL (on-chain) address directly', () => {
    expect(isFlowAllowed(AccountType.REINSURANCE, AccountType.EXTERNAL)).toBe(false);
  });

  it('the only ways money leaves reinsurance are back into INSURANCE or TREASURY', () => {
    expect(isFlowAllowed(AccountType.REINSURANCE, AccountType.INSURANCE)).toBe(true); // the backstop
    expect(isFlowAllowed(AccountType.REINSURANCE, AccountType.TREASURY)).toBe(true);
  });
});

describe('CB6 whitelist — the flows reinsurance actually needs', () => {
  it('INSURANCE → REINSURANCE is allowed (the 20% monthly clawback)', () => {
    expect(isFlowAllowed(AccountType.INSURANCE, AccountType.REINSURANCE)).toBe(true);
  });

  it('TREASURY → REINSURANCE is allowed (funding the backstop)', () => {
    expect(isFlowAllowed(AccountType.TREASURY, AccountType.REINSURANCE)).toBe(true);
  });

  it('a jackpot pool can never pay anything except a PLAYER', () => {
    // Jackpots pay winners — they are not a slush fund that can be swept elsewhere.
    expect(isFlowAllowed(AccountType.JACKPOT_GRAND, AccountType.PLAYER)).toBe(true);
    expect(isFlowAllowed(AccountType.JACKPOT_GRAND, AccountType.TREASURY)).toBe(false);
    expect(isFlowAllowed(AccountType.JACKPOT_GRAND, AccountType.REINSURANCE)).toBe(false);
  });
});
