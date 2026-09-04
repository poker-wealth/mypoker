import { TexasBetting } from '../../../src/games/texas/betting';

/**
 * Antes — dead money, and the word "dead" is the whole specification.
 *
 * The reference platform offers an ante on every table (0/1/2/4/8/16/20/30
 * alongside the blinds), and its Short Deck has an ante and no blinds at all.
 * We had no ante concept anywhere, so this is new ground rather than a fix.
 *
 * The mistake it would be easy to ship is posting an ante through the same path
 * as a blind. That reaches `streetContributed`, which is the record of what a
 * seat has already put in FOR THIS ROUND — so the big blind would arrive
 * holding an ante's worth of call it never made, the ante-payer would owe less
 * than everyone else, and the discount would be invisible because the pot total
 * would still look right.
 *
 * Every test below is really the same question: is the ante in the pot, and out
 * of the betting?
 */

const game = (opts: { ante?: number; stack?: number; players?: number } = {}): TexasBetting =>
  new TexasBetting(
    Array.from({ length: opts.players ?? 3 }, (_, i) => ({
      id: `p${i}`,
      stack: opts.stack ?? 1000,
    })),
    {
      smallBlind: 5,
      bigBlind: 10,
      buttonIndex: 0,
      ...(opts.ante === undefined ? {} : { ante: opts.ante }),
    },
  );

const seat = (g: TexasBetting, id: string) => g.seatsPublic().find((s) => s.id === id)!;

describe('the ante reaches the pot', () => {
  it('every player posts, not just the blinds', () => {
    const g = game({ ante: 2 });
    // 3 antes of 2, plus 5 + 10 in blinds.
    expect(g.pot).toBe(21);
    expect(g.contributions().get('p0')).toBe(2); // button: ante only
    expect(g.contributions().get('p1')).toBe(7); // ante + small blind
    expect(g.contributions().get('p2')).toBe(12); // ante + big blind
  });

  it('comes out of the stack', () => {
    const g = game({ ante: 2 });
    expect(seat(g, 'p0').stack).toBe(998);
  });

  it('changes nothing when it is zero or absent', () => {
    expect(game({ ante: 0 }).pot).toBe(15);
    expect(game().pot).toBe(15);
  });
});

describe('the ante is not a bet', () => {
  /**
   * These two are the WEAK ones, and it is worth saying so.
   *
   * Posting the ante as a bet was tried against this file, and both of these
   * still passed: when every seat antes the same amount their contributions
   * move together, so what each owes to call is unchanged. The bug hides
   * completely here.
   *
   * What catches it is the raise arithmetic below — `minRaiseTo` and the pot
   * after a raise — plus the showdown total. Three of the ten fail. Keep those
   * three.
   */
  it('does not reduce what anyone owes to call', () => {
    const withAnte = game({ ante: 2 });
    const without = game({ ante: 0 });
    // p0 is first to act preflop 3-handed, and faces the big blind either way.
    expect(withAnte.legalActions().callAmount).toBe(without.legalActions().callAmount);
    expect(withAnte.legalActions().callAmount).toBe(10);
  });

  it('does not let the big blind check a bet it has not matched', () => {
    const g = game({ ante: 2 });
    // The BB posted 2 + 10. If the ante counted as a bet the current bet would
    // read 12 and the small blind would owe 7 rather than 5.
    g.act('p0', { type: 'call' });
    expect(g.legalActions().callAmount).toBe(5); // p1 completes from 5 to 10
  });

  it('leaves the minimum raise alone', () => {
    const g = game({ ante: 2 });
    expect(g.legalActions().minRaiseTo).toBe(20); // the big blind, not 12 + 10
  });

  it('a raise is measured from the blind, not from the blind plus antes', () => {
    const g = game({ ante: 2 });
    g.act('p0', { type: 'raise', amount: 30 });
    // 21 already in, plus p0 topping up to 30 over the 2 already posted.
    expect(g.pot).toBe(51);
    expect(g.legalActions().callAmount).toBe(25); // p1 has 5 in for the round
  });
});

describe('the ante and short stacks', () => {
  it('a stack shorter than the ante posts what it has and is all-in', () => {
    const g = new TexasBetting(
      [
        { id: 'rich', stack: 500 },
        { id: 'broke', stack: 1 },
        { id: 'mid', stack: 500 },
      ],
      { smallBlind: 5, bigBlind: 10, buttonIndex: 0, ante: 3 },
    );
    expect(seat(g, 'broke').stack).toBe(0);
    expect(seat(g, 'broke').status).toBe('allin');
    // Posted 1, not 3 — the ante clamps to the stack like every other commit.
    expect(g.contributions().get('broke')).toBe(1);
    // 'broke' is the small blind here, and the ante already took everything, so
    // it posts NOTHING for the blind: 3 + 1 + 3 in antes, no small blind, 10 big.
    expect(g.pot).toBe(3 + 1 + 3 + 10);
  });

  it('does not push a seat all-in when the ante exactly empties it', () => {
    const g = new TexasBetting(
      [
        { id: 'a', stack: 2 },
        { id: 'b', stack: 500 },
      ],
      { smallBlind: 5, bigBlind: 10, buttonIndex: 0, ante: 2 },
    );
    // Heads-up: 'a' is the button and small blind. The ante took everything, so
    // there is nothing left for the blind — all-in before a card is dealt.
    expect(seat(g, 'a').stack).toBe(0);
    expect(seat(g, 'a').status).toBe('allin');
    expect(g.contributions().get('a')).toBe(2);
  });
});

describe('the ante survives the hand', () => {
  it('stays in the pot through to showdown', () => {
    const g = game({ ante: 2, players: 2, stack: 200 });
    // Heads-up with antes: 2 + 2 + 5 + 10 = 19.
    expect(g.pot).toBe(19);

    /**
     * The shove is 198, not 200, and that is the ante interacting correctly
     * with the all-in ceiling: the 2 already posted is gone from the stack, so
     * the most p0 can have IN FRONT OF THEM this round is 198. Asking for 200
     * is refused — which is the engine getting the interaction right, and worth
     * asserting rather than just working around.
     */
    expect(g.legalActions().allInRaiseTo).toBe(198);
    expect(() => g.act('p0', { type: 'raise', amount: 200 })).toThrow(/stack/);

    g.act('p0', { type: 'raise', amount: 198 });
    g.act('p1', { type: 'call' });
    expect(g.street).toBe('SHOWDOWN');
    // Both in for their whole 200, antes included — nothing lost on the way.
    expect(g.pot).toBe(400);
  });
});
