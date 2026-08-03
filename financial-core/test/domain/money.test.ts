import { Decimal128 } from 'bson';
import { Money } from '../../src/domain/money';

describe('Money — exact integer money, no floats', () => {
  describe('construction', () => {
    it('builds from micro-units', () => {
      expect(Money.fromMicros(12_500_000n).toString()).toBe('12.500000');
    });

    it('builds from a decimal string', () => {
      expect(Money.fromDecimalString('12.5').toMicros()).toBe(12_500_000n);
      expect(Money.fromDecimalString('0.000001').toMicros()).toBe(1n);
      expect(Money.fromDecimalString('-3.25').toMicros()).toBe(-3_250_000n);
      expect(Money.fromDecimalString('1000000').toMicros()).toBe(1_000_000_000_000n);
    });

    it('rejects precision finer than 6 decimal places (no silent rounding)', () => {
      expect(() => Money.fromDecimalString('1.0000001')).toThrow(RangeError);
    });

    it('rejects garbage input', () => {
      expect(() => Money.fromDecimalString('abc')).toThrow(RangeError);
      expect(() => Money.fromDecimalString('1.2.3')).toThrow(RangeError);
      expect(() => Money.fromDecimalString('')).toThrow(RangeError);
    });

    it('round-trips through Decimal128 (the storage boundary)', () => {
      const m = Money.fromDecimalString('987654.321000');
      const stored: Decimal128 = m.toDecimal128();
      const back = Money.fromDecimal128(stored);
      expect(back.equals(m)).toBe(true);
    });
  });

  describe('arithmetic is exact', () => {
    it('adds and subtracts without binary-float error', () => {
      // 0.1 + 0.2 !== 0.3 in float; must be exact here.
      const a = Money.fromDecimalString('0.1');
      const b = Money.fromDecimalString('0.2');
      expect(a.add(b).toString()).toBe('0.300000');
      expect(a.add(b).equals(Money.fromDecimalString('0.3'))).toBe(true);
    });

    it('subtracts to negative deltas', () => {
      expect(Money.fromDecimalString('1').subtract(Money.fromDecimalString('3')).toMicros()).toBe(
        -2_000_000n,
      );
    });

    it('sums an array exactly', () => {
      const parts = ['0.1', '0.2', '0.3', '0.4'].map((s) => Money.fromDecimalString(s));
      expect(Money.sum(parts).toString()).toBe('1.000000');
    });
  });

  describe('basis-point multiply (rake / jackpot injection)', () => {
    it('computes 0.5% (50 bp) of winner profit', () => {
      // 0.5% of 1000 = 5
      expect(Money.fromDecimalString('1000').mulBasisPoints(50n).toString()).toBe('5.000000');
    });

    it('computes 5% (500 bp) rake', () => {
      expect(Money.fromDecimalString('100').mulBasisPoints(500n).toString()).toBe('5.000000');
    });

    it('floors toward zero at sub-micro precision (deterministic)', () => {
      // 1 micro-unit * 50bp = 0.005 micro -> floors to 0
      expect(Money.fromMicros(1n).mulBasisPoints(50n).toMicros()).toBe(0n);
    });
  });

  describe('predicates and comparisons', () => {
    it('reports zero / sign', () => {
      expect(Money.ZERO.isZero()).toBe(true);
      expect(Money.fromMicros(-1n).isNegative()).toBe(true);
      expect(Money.fromMicros(1n).isPositive()).toBe(true);
    });

    it('compares', () => {
      const a = Money.fromDecimalString('10');
      const b = Money.fromDecimalString('20');
      expect(a.lessThan(b)).toBe(true);
      expect(b.greaterThanOrEqual(a)).toBe(true);
      expect(a.greaterThanOrEqual(a)).toBe(true);
      expect(a.equals(Money.fromMicros(10_000_000n))).toBe(true);
    });
  });

  describe('serialization', () => {
    it('always renders exactly 6 decimal places', () => {
      expect(Money.fromMicros(0n).toString()).toBe('0.000000');
      expect(Money.fromDecimalString('5').toString()).toBe('5.000000');
    });

    it('serializes to JSON as a decimal string (never a float)', () => {
      expect(JSON.stringify({ amount: Money.fromDecimalString('1.5') })).toBe(
        '{"amount":"1.500000"}',
      );
    });
  });
});
