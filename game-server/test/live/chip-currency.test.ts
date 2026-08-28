import { chipsToUsdt, usdtToChips } from '../../src/live/chip-currency';

/**
 * The unit boundary. 1 chip = 1 cent = $0.01 (v5.9 spec: amounts are integer cents). If this ever
 * drifts, every buy-in and settlement is silently mis-priced by a factor of 100 — so it is pinned.
 */
describe('chip ↔ USDT (1 chip = $0.01)', () => {
  it('converts chips to USDT decimals exactly', () => {
    expect(chipsToUsdt('2000')).toBe('20.00');
    expect(chipsToUsdt('5')).toBe('0.05');
    expect(chipsToUsdt('105')).toBe('1.05');
    expect(chipsToUsdt('0')).toBe('0.00');
    expect(chipsToUsdt('50000')).toBe('500.00');
  });

  it('converts USDT decimals (any precision) back to whole chips, flooring sub-cent dust', () => {
    expect(usdtToChips('20')).toBe(2000);
    expect(usdtToChips('20.00')).toBe(2000);
    expect(usdtToChips('0.05')).toBe(5);
    expect(usdtToChips('500.000000')).toBe(50000); // a real 6-decimal deposit
    expect(usdtToChips('1.059')).toBe(105); // 0.9 cent of dust is floored, never rounded up
  });

  it('round-trips whole-cent amounts', () => {
    for (const chips of ['1', '20', '2000', '99', '123456']) {
      expect(usdtToChips(chipsToUsdt(chips))).toBe(Number(chips));
    }
  });

  it('rejects malformed amounts rather than guessing', () => {
    expect(() => chipsToUsdt('20.5')).toThrow();
    expect(() => chipsToUsdt('-5')).toThrow();
    expect(() => usdtToChips('abc')).toThrow();
    expect(() => usdtToChips('-1.00')).toThrow();
  });
});
