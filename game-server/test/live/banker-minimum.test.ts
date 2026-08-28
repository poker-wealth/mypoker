import { bankerMinimumFor, MAX_HAND_MULTIPLIER } from '../../src/live/niu-niu-room';
import { defaultTables } from '../../src/live/server';

/**
 * THE BANK MUST BE ABLE TO COVER THE TABLE IT SITS AT.
 *
 * Niu Niu's exposure guard refuses a bet the banker cannot pay — that is the iron rule, because the
 * alternative is the platform quietly making up the shortfall. The guard was right; the TABLE was
 * wrong. Its minimum buy-in was $1,000 while a full table's worst case is $3,000, so a second
 * bettor was refused outright with "aggregate bets exceed banker stack capacity" and the game
 * looked broken to anyone who tried to play it.
 *
 * The worst case is every other seat staking the minimum and every one of them turning over Five
 * Small, which pays 6x. This pins the table's minimum to that arithmetic so the two cannot drift:
 * add a seat, raise the stake, or change the top multiplier, and the buy-in has to follow.
 */
describe('the Niu Niu banker minimum', () => {
  it('covers every other seat at the worst hand on the ladder', () => {
    // Six seats, $100 minimum stake: five opponents × 100 × 6.
    expect(bankerMinimumFor(6, 100)).toBe(3_000);
  });

  it('scales with the table, not with a number someone typed once', () => {
    expect(bankerMinimumFor(3, 100)).toBe(1_200);
    expect(bankerMinimumFor(6, 50)).toBe(1_500);
    // A heads-up table has exactly one opponent to cover.
    expect(bankerMinimumFor(2, 100)).toBe(600);
  });

  it('is not negative at a table nobody can bet at', () => {
    expect(bankerMinimumFor(1, 100)).toBe(0);
    expect(bankerMinimumFor(0, 100)).toBe(0);
  });

  it('follows the exposure rule the room actually enforces', () => {
    // If MAX_HAND_MULTIPLIER ever changes, this arithmetic has to change with it — the guard reads
    // the same constant when it prices a bet.
    expect(bankerMinimumFor(6, 100)).toBe(5 * 100 * MAX_HAND_MULTIPLIER);
  });

  it('the live niu-niu table is opened at that minimum', () => {
    const table = defaultTables().find((t) => t.id === 'niu-niu');
    expect(table).toBeDefined();

    // `LiveTableConfig` leaves these optional because it covers every game; niu-niu always sets
    // them, and the assertion is meaningless if either is missing.
    const { minBuyIn, maxSeats } = table as { minBuyIn?: number; maxSeats?: number };
    expect(typeof minBuyIn).toBe('number');
    expect(typeof maxSeats).toBe('number');

    // The real failure this guards: a table configured below its own exposure rule takes bets it
    // must then refuse.
    expect(minBuyIn).toBe(bankerMinimumFor(maxSeats!, 100));
    expect(minBuyIn).toBeGreaterThanOrEqual(3_000);
  });
});
