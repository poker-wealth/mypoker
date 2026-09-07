import { IllegalActionError, TexasBetting } from '../../../src/games/texas/betting';

/**
 * The creator's game options that change the betting itself: the straddle and
 * all-in-or-fold. (The ante has its own file; the room-level options — hide
 * hole-cards, auto-start, the seat rules — live in test/live.)
 *
 * Blinds here are 5/10 unless a test says otherwise, so a straddle is 20 and
 * the numbers stay easy to check by hand.
 */

const game = (
  opts: { straddle?: boolean; allInOrFold?: boolean; stacks?: number[] } = {},
): TexasBetting =>
  new TexasBetting(
    (opts.stacks ?? [1000, 1000, 1000, 1000]).map((stack, i) => ({ id: `p${i}`, stack })),
    {
      smallBlind: 5,
      bigBlind: 10,
      buttonIndex: 0,
      ...(opts.straddle ? { straddle: true } : {}),
      ...(opts.allInOrFold ? { allInOrFold: true } : {}),
    },
  );

const seat = (g: TexasBetting, id: string) => g.seatsPublic().find((s) => s.id === id)!;

describe('straddle — a live third blind', () => {
  it('the seat after the big blind posts 2×BB and it reaches the pot', () => {
    const g = game({ straddle: true });
    // sb 5 + bb 10 + straddle 20.
    expect(g.pot).toBe(35);
    expect(seat(g, 'p3').streetContributed).toBe(20);
    expect(seat(g, 'p3').stack).toBe(980);
  });

  it('action starts after the straddler, who owes the table nothing', () => {
    const g = game({ straddle: true });
    expect(g.toAct).toBe('p0'); // button+4 in a 4-handed game
    expect(g.legalActions().callAmount).toBe(20);
  });

  it('the minimum raise is to twice the straddle', () => {
    const g = game({ straddle: true });
    // The straddle is the last full bet: min raise-to = 20 + 20.
    expect(g.legalActions().minRaiseTo).toBe(40);
  });

  it('the straddler keeps the option when everyone just calls', () => {
    const g = game({ straddle: true });
    g.act('p0', { type: 'call' });
    g.act('p1', { type: 'call' }); // small blind completes to 20
    g.act('p2', { type: 'call' }); // big blind completes to 20
    // Back to the straddler, unraised — their turn, not a dealt flop.
    expect(g.street).toBe('PREFLOP');
    expect(g.toAct).toBe('p3');
    expect(g.legalActions().canCheck).toBe(true);
    g.act('p3', { type: 'check' });
    expect(g.street).toBe('FLOP');
  });

  it('is ignored heads-up', () => {
    const g = game({ straddle: true, stacks: [1000, 1000] });
    expect(g.pot).toBe(15); // just the blinds
    expect(g.toAct).toBe('p0'); // button acts first heads-up, as always
  });

  it('a short straddler posts what they have and is all-in', () => {
    const g = game({ straddle: true, stacks: [1000, 1000, 1000, 12] });
    expect(seat(g, 'p3').status).toBe('allin');
    expect(seat(g, 'p3').streetContributed).toBe(12);
    // The bet to match is the short straddle, not a full 20 — same rule as a
    // short big blind.
    expect(g.legalActions().callAmount).toBe(12);
  });
});

describe('all-in or fold — two buttons, enforced server-side', () => {
  it('offers only fold and the full shove', () => {
    const g = game({ allInOrFold: true });
    const legal = g.legalActions();
    expect(legal.canFold).toBe(true);
    expect(legal.canCheck).toBe(false);
    expect(legal.callAmount).toBeNull(); // a flat call is not on the menu
    expect(legal.minRaiseTo).toBe(1000); // the only raise is everything
    expect(legal.maxRaiseTo).toBe(1000);
  });

  it('refuses a check, a flat call and a partial raise', () => {
    const g = game({ allInOrFold: true });
    expect(() => g.act('p3', { type: 'check' })).toThrow(IllegalActionError);
    expect(() => g.act('p3', { type: 'call' })).toThrow(IllegalActionError);
    expect(() => g.act('p3', { type: 'raise', amount: 500 })).toThrow(IllegalActionError);
    g.act('p3', { type: 'raise', amount: 1000 }); // the shove is legal
    expect(seat(g, 'p3').status).toBe('allin');
  });

  it('a shorter stack calls a bigger shove — and that call IS their all-in', () => {
    const g = game({ allInOrFold: true, stacks: [1000, 50, 1000, 1000] });
    g.act('p3', { type: 'raise', amount: 1000 });
    g.act('p0', { type: 'fold' });
    // p1 posted the small blind (5) and has 45 behind against a 995 call —
    // calling commits everything, which is exactly what AoF permits.
    expect(g.toAct).toBe('p1');
    expect(g.legalActions().callAmount).toBe(45);
    g.act('p1', { type: 'call' });
    expect(seat(g, 'p1').status).toBe('allin');
  });

  it('folding to the big blind still ends the hand without them acting', () => {
    const g = game({ allInOrFold: true, stacks: [1000, 1000, 1000] });
    g.act('p0', { type: 'fold' });
    g.act('p1', { type: 'fold' });
    expect(g.winnerByFold()).toBe('p2');
  });
});
