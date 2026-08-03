import { TexasBetting, IllegalActionError } from '../../../src/games/texas/betting';

function newGame(
  count: number,
  opts: { sb?: number; bb?: number; button?: number; stack?: number } = {},
): TexasBetting {
  const stack = opts.stack ?? 1000;
  const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, stack }));
  return new TexasBetting(players, {
    smallBlind: opts.sb ?? 5,
    bigBlind: opts.bb ?? 10,
    buttonIndex: opts.button ?? 0,
  });
}

describe('Texas betting — blinds & opening order', () => {
  it('posts blinds and opens on the correct seat (3-handed)', () => {
    const g = newGame(3); // button p0 → sb p1, bb p2, first to act p0
    expect(g.pot).toBe(15);
    expect(g.street).toBe('PREFLOP');
    expect(g.toAct).toBe('p0');
    const la = g.legalActions();
    expect(la.callAmount).toBe(10);
    expect(la.canCheck).toBe(false);
    expect(la.minRaiseTo).toBe(20);
  });

  it('heads-up: button is the small blind and acts first preflop', () => {
    const g = newGame(2); // button p0 = SB, p1 = BB
    expect(g.toAct).toBe('p0');
    expect(g.pot).toBe(15);
  });
});

describe('Texas betting — a full betting round', () => {
  it('completes preflop when all call and the big blind checks its option', () => {
    const g = newGame(3);
    g.act('p0', { type: 'call' }); // UTG/button calls 10
    g.act('p1', { type: 'call' }); // SB completes to 10
    expect(g.street).toBe('PREFLOP');
    g.act('p2', { type: 'check' }); // BB checks option → street advances
    expect(g.street).toBe('FLOP');
    expect(g.pot).toBe(30);
    expect(g.toAct).toBe('p1'); // postflop, first active after button
  });

  it('checks around the flop and advances to the turn', () => {
    const g = newGame(3);
    g.act('p0', { type: 'call' });
    g.act('p1', { type: 'call' });
    g.act('p2', { type: 'check' });
    // flop: p1, p2, p0 all check
    g.act('p1', { type: 'check' });
    g.act('p2', { type: 'check' });
    g.act('p0', { type: 'check' });
    expect(g.street).toBe('TURN');
  });
});

describe('Texas betting — raises', () => {
  it('a raise reopens the action for everyone still in', () => {
    const g = newGame(3);
    g.act('p0', { type: 'raise', amount: 30 });
    expect(g.toAct).toBe('p1'); // action moves on
    g.act('p1', { type: 'call' }); // calls 30
    g.act('p2', { type: 'call' }); // BB calls 30 (must act again after the raise)
    expect(g.street).toBe('FLOP');
    expect(g.pot).toBe(90);
  });

  it('enforces the minimum raise size', () => {
    const g = newGame(3);
    // current bet 10, min raise 10 → min raise-to is 20.
    expect(() => g.act('p0', { type: 'raise', amount: 15 })).toThrow(IllegalActionError);
  });

  it('rejects acting out of turn', () => {
    const g = newGame(3);
    expect(() => g.act('p2', { type: 'check' })).toThrow(IllegalActionError);
  });
});

describe('Texas betting — folds & all-in', () => {
  it('awards the pot to the last player standing when others fold', () => {
    const g = newGame(3);
    g.act('p0', { type: 'fold' });
    g.act('p1', { type: 'fold' });
    expect(g.handComplete).toBe(true);
    expect(g.winnerByFold()).toBe('p2');
  });

  it('marks a player all-in when they commit their whole stack', () => {
    const g = newGame(3, { stack: 200 });
    g.act('p0', { type: 'raise', amount: 200 }); // shove
    const p0 = g.seatsPublic().find((s) => s.id === 'p0')!;
    expect(p0.status).toBe('allin');
    expect(p0.stack).toBe(0);
  });

  it('tracks per-player contributions for side-pot construction', () => {
    const g = newGame(3);
    g.act('p0', { type: 'raise', amount: 30 });
    g.act('p1', { type: 'fold' });
    g.act('p2', { type: 'call' });
    const c = g.contributions();
    expect(c.get('p0')).toBe(30);
    expect(c.get('p2')).toBe(30);
    expect(c.get('p1')).toBe(5); // posted SB then folded
  });
});

describe('Texas betting — all-in shortcut to showdown', () => {
  it('skips remaining betting when fewer than 2 players can act', () => {
    const g = newGame(2, { stack: 100, sb: 5, bb: 10 });
    // heads-up: p0 (button/SB) shoves, p1 calls all-in → both all-in → straight to showdown
    g.act('p0', { type: 'raise', amount: 100 });
    g.act('p1', { type: 'call' });
    expect(g.street).toBe('SHOWDOWN');
    expect(g.handComplete).toBe(true);
  });
});
