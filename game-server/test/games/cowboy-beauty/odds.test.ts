import {
  poolTotals,
  impliedOddsBps,
  distributePool,
  type PoolBet,
} from '../../../src/games/cowboy-beauty/odds';

const bet = (playerId: string, side: 'COWBOY' | 'BEAUTY', amount: number): PoolBet => ({
  playerId,
  side,
  amount,
});
const sum = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);

describe('pari-mutuel pools', () => {
  it('totals each side', () => {
    const pools = poolTotals([bet('a', 'COWBOY', 100), bet('b', 'COWBOY', 50), bet('c', 'BEAUTY', 300)]);
    expect(pools).toEqual({ COWBOY: 150, BEAUTY: 300 });
  });

  it('implied odds are total ÷ side pool, and null for an unbacked side', () => {
    // 150 + 300 = 450 total. Cowboy: 450/150 = 3.00×, Beauty: 450/300 = 1.50×
    expect(impliedOddsBps({ COWBOY: 150, BEAUTY: 300 })).toEqual({ COWBOY: 30000, BEAUTY: 15000 });
    expect(impliedOddsBps({ COWBOY: 100, BEAUTY: 0 })).toEqual({ COWBOY: 10000, BEAUTY: null });
  });
});

describe('distributePool', () => {
  it('winners split the losing pool pro-rata; losers forfeit; sums to zero', () => {
    const bets = [bet('a', 'COWBOY', 100), bet('b', 'COWBOY', 300), bet('c', 'BEAUTY', 200)];
    const net = distributePool(bets, 'COWBOY'); // losing pool 200 split 100:300
    expect(net.get('a')).toBe(50);
    expect(net.get('b')).toBe(150);
    expect(net.get('c')).toBe(-200);
    expect(sum(net)).toBe(0);
  });

  it('rounding dust goes to the biggest stake, still summing to zero', () => {
    // losing pool 10 split across stakes 2 and 1 → 6.66 / 3.33 → floors 6 and 3, dust 1 → to 'big'
    const bets = [bet('big', 'COWBOY', 2), bet('small', 'COWBOY', 1), bet('l', 'BEAUTY', 10)];
    const net = distributePool(bets, 'COWBOY');
    expect(net.get('big')).toBe(7);
    expect(net.get('small')).toBe(3);
    expect(sum(net)).toBe(0);
  });

  it('voids (no money moves) when a side is unbacked', () => {
    expect(distributePool([bet('a', 'COWBOY', 100)], 'COWBOY').size).toBe(0); // nobody to lose
    expect(distributePool([bet('a', 'COWBOY', 100)], 'BEAUTY').size).toBe(0); // nobody backed winner
  });
});
