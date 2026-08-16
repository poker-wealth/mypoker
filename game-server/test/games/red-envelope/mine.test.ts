import { extractDigit } from '../../../src/games/red-envelope/engine/mine/digitExtractor';
import { evaluateMine } from '../../../src/games/red-envelope/engine/mine/evaluator';
import { settleClaim } from '../../../src/games/red-envelope/engine/mine/settlement';
import { toMoney } from '../../../src/games/red-envelope/engine/money/money';

describe('Red Envelope Mine Engine', () => {
  describe('digitExtractor', () => {
    it('should extract the last whole digit', () => {
      // 1234 units = 12.34
      const amount = toMoney(1234);
      expect(extractDigit(amount, 'LAST_WHOLE_DIGIT', 100)).toBe(2);
      
      const amount2 = toMoney(900); // 9.00
      expect(extractDigit(amount2, 'LAST_WHOLE_DIGIT', 100)).toBe(9);
    });

    it('should extract the last decimal digit', () => {
      // 1234 units = 12.34
      const amount = toMoney(1234);
      expect(extractDigit(amount, 'LAST_DECIMAL_DIGIT', 100)).toBe(4);
      
      const amount2 = toMoney(900); // 9.00
      expect(extractDigit(amount2, 'LAST_DECIMAL_DIGIT', 100)).toBe(0);
    });
  });

  describe('evaluateMine', () => {
    it('should hit the mine when the digit matches', () => {
      const amount = toMoney(1250); // 12.50
      
      // Checking last decimal digit (0), mine is 0
      const evaluation = evaluateMine(amount, 0, 'LAST_DECIMAL_DIGIT');
      expect(evaluation.checkedDigit).toBe(0);
      expect(evaluation.mineHit).toBe(true);
    });

    it('should be safe when the digit does not match', () => {
      const amount = toMoney(1259); // 12.59
      
      // Checking last decimal digit (9), mine is 0
      const evaluation = evaluateMine(amount, 0, 'LAST_DECIMAL_DIGIT');
      expect(evaluation.checkedDigit).toBe(9);
      expect(evaluation.mineHit).toBe(false);
    });
    
    it('evaluates all mine numbers correctly (0-9)', () => {
      for (let i = 0; i <= 9; i++) {
        const amount = toMoney(1000 + i); // 10.00 to 10.09
        const evaluationHit = evaluateMine(amount, i, 'LAST_DECIMAL_DIGIT');
        expect(evaluationHit.mineHit).toBe(true);
        
        const evaluationSafe = evaluateMine(amount, (i + 1) % 10, 'LAST_DECIMAL_DIGIT');
        expect(evaluationSafe.mineHit).toBe(false);
      }
    });
  });

  describe('settlement', () => {
    it('should return safe claim settlement', () => {
      const amount = toMoney(1000);
      const evalSafe = { checkedDigit: 9, mineNumber: 0, mineHit: false };
      
      const result = settleClaim(amount, evalSafe, { penaltyMultiplier: 2, roundingPolicy: 'ROUND_HALF_UP' });
      expect(result.prizeKept.units).toBe(1000);
      expect(result.penaltyPaid.units).toBe(0);
      expect(result.finalNetChange).toBe(1000);
    });

    it('should calculate penalty and forfeit prize on mine hit', () => {
      const amount = toMoney(1000);
      const evalHit = { checkedDigit: 0, mineNumber: 0, mineHit: true };
      
      const result = settleClaim(amount, evalHit, { penaltyMultiplier: 2, roundingPolicy: 'ROUND_HALF_UP' });
      expect(result.prizeKept.units).toBe(0);
      expect(result.penaltyPaid.units).toBe(2000);
      expect(result.finalNetChange).toBe(-2000);
    });

    it('should round correctly based on configured policy', () => {
      const amount = toMoney(1457);
      const evalHit = { checkedDigit: 7, mineNumber: 7, mineHit: true };
      
      // 1457 * 1.5 = 2185.5
      const resDown = settleClaim(amount, evalHit, { penaltyMultiplier: 1.5, roundingPolicy: 'ROUND_DOWN' });
      expect(resDown.penaltyPaid.units).toBe(2185);
      
      const resUp = settleClaim(amount, evalHit, { penaltyMultiplier: 1.5, roundingPolicy: 'ROUND_UP' });
      expect(resUp.penaltyPaid.units).toBe(2186);
      
      const resHalfUp = settleClaim(amount, evalHit, { penaltyMultiplier: 1.5, roundingPolicy: 'ROUND_HALF_UP' });
      expect(resHalfUp.penaltyPaid.units).toBe(2186); // .5 rounds up
    });
  });
});
