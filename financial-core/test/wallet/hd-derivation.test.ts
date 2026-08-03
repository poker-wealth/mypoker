import {
  treasuryPath,
  insurancePath,
  reinsurancePath,
  leagueInventoryPath,
  jackpotPath,
  playerDepositPath,
  TreasuryTier,
} from '../../src/wallet/hd-derivation';
import { AccountType } from '../../src/domain/account-types';

describe('HD wallet derivation paths (BIP-44, TRON 195\')', () => {
  it('derives the three treasury tiers', () => {
    expect(treasuryPath(TreasuryTier.HOT)).toBe("m/44'/195'/0'/0/0");
    expect(treasuryPath(TreasuryTier.WARM)).toBe("m/44'/195'/0'/0/1");
    expect(treasuryPath(TreasuryTier.COLD)).toBe("m/44'/195'/0'/0/2");
  });

  it('derives insurance and reinsurance paths', () => {
    expect(insurancePath()).toBe("m/44'/195'/0'/1/0");
    expect(reinsurancePath()).toBe("m/44'/195'/0'/2/0");
  });

  it('derives per-league inventory paths', () => {
    expect(leagueInventoryPath(0)).toBe("m/44'/195'/0'/3/0");
    expect(leagueInventoryPath(7)).toBe("m/44'/195'/0'/3/7");
  });

  it('derives per-table per-tier jackpot paths', () => {
    expect(jackpotPath(AccountType.JACKPOT_MINI, 3)).toBe("m/44'/195'/0'/4/3/0");
    expect(jackpotPath(AccountType.JACKPOT_MINOR, 3)).toBe("m/44'/195'/0'/4/3/1");
    expect(jackpotPath(AccountType.JACKPOT_MAJOR, 3)).toBe("m/44'/195'/0'/4/3/2");
    expect(jackpotPath(AccountType.JACKPOT_GRAND, 3)).toBe("m/44'/195'/0'/4/3/3");
  });

  it('derives per-player deposit paths', () => {
    expect(playerDepositPath(42)).toBe("m/44'/195'/0'/5/42");
  });

  it('rejects a non-jackpot type and negative indexes', () => {
    expect(() => jackpotPath(AccountType.PLAYER, 1)).toThrow(/not a jackpot/);
    expect(() => playerDepositPath(-1)).toThrow(RangeError);
    expect(() => leagueInventoryPath(1.5)).toThrow(RangeError);
  });
});
