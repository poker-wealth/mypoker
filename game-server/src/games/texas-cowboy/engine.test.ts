import { TexasCowboyEngine, DEFAULT_MARKETS } from './engine';
import { createDeck, evaluateTexasCowboyHand, compareCowboyHands } from './poker';

/**
 * Texas Cowboy — the round, the odds board, and the money.
 *
 * The engine is the authority: it decides the cards, the winner and what every bet is worth, and
 * it hands out copies of its state so nothing outside can rewrite the round. (An earlier test
 * tried to rig the deal with `getRoundState().cowboy.holeCards = [...]` and quietly asserted
 * against a throwaway object — hence `deal({ deck })`, which is the supported way to pin a round.)
 *
 * The money rule this table lives under: nobody banks it, so the round is player-funded. Every
 * naira paid out came from a naira staked, and the net changes sum to zero before rake.
 */

/**
 * A deck that deals a chosen board. Order is cowboy's two, cowgirl's two, then five community.
 * Everything after that is padding the round never touches.
 */
function stackedDeck(cowboy: [string, string], cowgirl: [string, string], board: string[]): string[] {
  const used = new Set([...cowboy, ...cowgirl, ...board]);
  const rest = createDeck().filter((c) => !used.has(c));
  return [...cowboy, ...cowgirl, ...board, ...rest];
}

function roundTo(engine: TexasCowboyEngine, deck: string[]): void {
  engine.lockBetting();
  engine.deal({ deck });
  engine.revealFlop();
  engine.revealTurn();
  engine.revealRiver();
  engine.evaluateHands();
}

/** Cowboy holds a straight flush; cowgirl has nothing. */
const COWBOY_RUNAWAY = stackedDeck(['2s', '3s'], ['2h', '7d'], ['4s', '5s', '6s', 'Td', 'Jc']);

describe('Texas Cowboy — the round', () => {
  let engine: TexasCowboyEngine;
  beforeEach(() => {
    engine = new TexasCowboyEngine('round-1', 1);
  });

  it('starts in WAITING with the full odds board', () => {
    const state = engine.getRoundState();
    expect(state.phase).toBe('WAITING');
    expect(state.markets).toHaveLength(DEFAULT_MARKETS.length);
    expect(state.result).toBeNull();
  });

  it('opens a 12-second window on the server clock', () => {
    engine.openBetting(12_000, 1_000);
    const { bettingWindow, phase } = engine.getRoundState();
    expect(phase).toBe('BETTING_OPEN');
    expect(bettingWindow).toEqual({ openedAt: 1_000, closesAt: 13_000 });
  });

  it('deals nine distinct cards and walks the reveal in order', () => {
    engine.openBetting();
    engine.lockBetting();
    engine.deal({ deck: COWBOY_RUNAWAY });

    const dealt = engine.getRoundState();
    const cards = [...dealt.cowboy.holeCards, ...dealt.cowgirl.holeCards, ...dealt.communityCards];
    expect(cards).toHaveLength(9);
    expect(new Set(cards).size).toBe(9);

    expect(() => engine.revealTurn()).toThrow(); // no turn before the flop
    engine.revealFlop();
    expect(() => engine.evaluateHands()).toThrow(); // no showdown before the river
    engine.revealTurn();
    engine.revealRiver();
    engine.evaluateHands();
    expect(engine.getRoundState().phase).toBe('RESULTS');
  });

  it('reads the board the same way the poker evaluator does', () => {
    engine.openBetting();
    roundTo(engine, COWBOY_RUNAWAY);

    const state = engine.getRoundState();
    expect(state.cowboy.evaluation!.type).toBe('STRAIGHT_FLUSH');
    expect(state.result).toEqual({ winner: 'COWBOY', winningHandType: 'STRAIGHT_FLUSH' });

    // And the same conclusion reached directly, so the round is not inventing its own poker.
    const cowboy = evaluateTexasCowboyHand([...state.cowboy.holeCards, ...state.communityCards]);
    const cowgirl = evaluateTexasCowboyHand([...state.cowgirl.holeCards, ...state.communityCards]);
    expect(compareCowboyHands(cowboy, cowgirl)).toBe('COWBOY_WIN');
  });

  it('calls a genuine tie when both play the same board', () => {
    // Neither hole card plays: the board is the best five for both.
    const shared = stackedDeck(['2s', '3d'], ['2c', '3h'], ['As', 'Ks', 'Qs', 'Jh', 'Td']);
    engine.openBetting();
    roundTo(engine, shared);

    const state = engine.getRoundState();
    expect(state.result!.winner).toBe('TIE');
    expect(state.result!.winningHandType).toBeNull();
  });
});

describe('Texas Cowboy — the betting window', () => {
  let engine: TexasCowboyEngine;
  const bet = (userId: string, marketId: string, amount: number, at?: number) =>
    engine.placeBet({
      userId,
      marketId,
      amount,
      available: 10_000,
      ...(at === undefined ? {} : { serverTime: at }),
      generateId: () => `${userId}-${marketId}-${amount}`,
    });

  beforeEach(() => {
    engine = new TexasCowboyEngine('round-1', 1);
  });

  it('refuses a bet before the window opens', () => {
    expect(() => bet('u1', 'cowboy_win', 100)).toThrow(/Phase is WAITING/);
  });

  it('takes a bet inside the window and keeps the odds as they stood', () => {
    engine.openBetting(12_000, 1_000);
    const placed = bet('u1', 'cowboy_win', 500, 2_000);
    expect(placed.multiplier).toBe(2.02);
    expect(placed.status).toBe('ACTIVE');

    // Moving the market later does not move a bet already accepted.
    engine.getRoundState().markets[0]!.multiplier = 99;
    expect(engine.getBets()[0]!.multiplier).toBe(2.02);
  });

  it('refuses a bet that arrives after the deadline, by the server clock', () => {
    engine.openBetting(12_000, 1_000);
    expect(() => bet('u1', 'cowboy_win', 100, 13_001)).toThrow(/BETTING_CLOSED/);
  });

  it('refuses a bet once the window is locked', () => {
    engine.openBetting();
    engine.lockBetting();
    expect(() => bet('u1', 'cowboy_win', 100)).toThrow(/Phase is BETTING_LOCKED/);
  });

  it('refuses more than the player can cover, counting what they already staked', () => {
    engine.openBetting(12_000, 1_000);
    engine.placeBet({
      userId: 'u1', marketId: 'cowboy_win', amount: 800, available: 1_000,
      serverTime: 2_000, generateId: () => 'a',
    });
    expect(engine.stakedBy('u1')).toBe(800);
    expect(() =>
      engine.placeBet({
        userId: 'u1', marketId: 'tie', amount: 300, available: 200, // what is left
        serverTime: 2_000, generateId: () => 'b',
      }),
    ).toThrow(/INSUFFICIENT_CHIPS/);
  });

  it('treats a retried request as the same bet, not a second one', () => {
    engine.openBetting(12_000, 1_000);
    const args = {
      userId: 'u1', marketId: 'cowboy_win', amount: 500, available: 10_000,
      serverTime: 2_000, generateId: () => 'bet-1', idempotencyKey: 'req-42',
    };
    const first = engine.placeBet(args);
    const retry = engine.placeBet(args);
    expect(retry.id).toBe(first.id);
    expect(engine.getBets()).toHaveLength(1);
  });

  it('lets several users, and one user, hold several bets', () => {
    engine.openBetting(12_000, 1_000);
    bet('u1', 'cowboy_win', 500, 2_000);
    bet('u1', 'straight', 100, 2_000);
    bet('u2', 'tie', 200, 2_000);
    expect(engine.getBets()).toHaveLength(3);
    expect(engine.stakedBy('u1')).toBe(600);
  });
});

describe('Texas Cowboy — settlement is player-funded', () => {
  const openWith = (bets: [string, string, number][]): TexasCowboyEngine => {
    const engine = new TexasCowboyEngine('round-1', 1, { rakeBps: 0 });
    engine.openBetting(12_000, 1_000);
    for (const [userId, marketId, amount] of bets) {
      engine.placeBet({
        userId, marketId, amount, available: 100_000, serverTime: 2_000,
        generateId: () => `${userId}-${marketId}`,
      });
    }
    return engine;
  };

  const sum = (net: Map<string, number>): number => [...net.values()].reduce((a, b) => a + b, 0);

  it('pays the winners out of the losers, to the last chip', () => {
    const engine = openWith([
      ['winner', 'cowboy_win', 1_000],
      ['loser-a', 'cowgirl_win', 600],
      ['loser-b', 'tie', 400],
    ]);
    roundTo(engine, COWBOY_RUNAWAY);
    const { netByUser, pool } = engine.settleBets();

    expect(pool).toBe(1_000); // the two losing stakes
    expect(netByUser.get('winner')).toBe(1_000);
    expect(netByUser.get('loser-a')).toBe(-600);
    expect(netByUser.get('loser-b')).toBe(-400);
    expect(sum(netByUser)).toBe(0); // nothing created, nothing destroyed
  });

  it('splits the pool by stake × odds, so the long shot takes the bigger share', () => {
    // Both win: COWBOY at 2.02 and STRAIGHT_FLUSH at 248, staked the same.
    const engine = openWith([
      ['short-odds', 'cowboy_win', 100],
      ['long-odds', 'straight_flush', 100],
      ['loser', 'cowgirl_win', 1_000],
    ]);
    roundTo(engine, COWBOY_RUNAWAY);
    const { netByUser } = engine.settleBets();

    expect(netByUser.get('long-odds')!).toBeGreaterThan(netByUser.get('short-odds')!);
    expect(sum(netByUser)).toBe(0);
    expect(netByUser.get('long-odds')! + netByUser.get('short-odds')!).toBe(1_000);
  });

  it('voids the round when nobody backed the result — there is no house to keep it', () => {
    const engine = openWith([
      ['a', 'cowgirl_win', 500],
      ['b', 'tie', 500],
    ]);
    roundTo(engine, COWBOY_RUNAWAY);
    const { netByUser } = engine.settleBets();

    expect(sum(netByUser)).toBe(0);
    for (const bet of engine.getBets()) {
      expect(bet.status).toBe('VOID');
      expect(bet.grossReturn).toBe(bet.amount);
    }
  });

  it('loses hand-type bets on a tie by default, and voids them when configured to', () => {
    const shared = stackedDeck(['2s', '3d'], ['2c', '3h'], ['As', 'Ks', 'Qs', 'Jh', 'Td']);

    const strict = openWith([['a', 'straight', 100], ['b', 'tie', 100]]);
    roundTo(strict, shared);
    strict.settleBets();
    expect(strict.getBets().find((x) => x.userId === 'a')!.status).toBe('LOST');

    const lenient = new TexasCowboyEngine('r2', 1, { tieRule: 'HAND_TYPE_VOIDS' });
    lenient.openBetting(12_000, 1_000);
    lenient.placeBet({
      userId: 'a', marketId: 'straight', amount: 100, available: 1_000,
      serverTime: 2_000, generateId: () => 'x',
    });
    lenient.placeBet({
      userId: 'b', marketId: 'tie', amount: 100, available: 1_000,
      serverTime: 2_000, generateId: () => 'y',
    });
    roundTo(lenient, shared);
    lenient.settleBets();
    expect(lenient.getBets().find((x) => x.userId === 'a')!.status).toBe('VOID');
  });

  it('settles once, however many times it is asked', () => {
    const engine = openWith([
      ['winner', 'cowboy_win', 1_000],
      ['loser', 'cowgirl_win', 1_000],
    ]);
    roundTo(engine, COWBOY_RUNAWAY);

    const first = engine.settleBets();
    const again = engine.settleBets();
    expect([...again.netByUser]).toEqual([...first.netByUser]);
    expect(engine.getBets().filter((b) => b.status === 'WON')).toHaveLength(1);
  });

  it('records what each bet returned, gross and net', () => {
    const engine = openWith([
      ['winner', 'cowboy_win', 1_000],
      ['loser', 'cowgirl_win', 1_000],
    ]);
    roundTo(engine, COWBOY_RUNAWAY);
    engine.settleBets();

    const won = engine.getBets().find((b) => b.userId === 'winner')!;
    expect(won.status).toBe('WON');
    expect(won.netProfit).toBe(1_000);
    expect(won.grossReturn).toBe(2_000); // stake back plus the winnings

    const lost = engine.getBets().find((b) => b.userId === 'loser')!;
    expect(lost.status).toBe('LOST');
    expect(lost.grossReturn).toBe(0);
    expect(lost.netProfit).toBe(-1_000);
  });
});

describe('Texas Cowboy — the engine owns the round', () => {
  it('cannot be rigged through the state it hands out', () => {
    const engine = new TexasCowboyEngine('round-1', 1);
    engine.openBetting();
    engine.lockBetting();
    engine.deal({ deck: COWBOY_RUNAWAY });

    const stolen = engine.getRoundState();
    stolen.cowboy.holeCards = ['As', 'Ah'];
    stolen.phase = 'RESULTS';

    expect(engine.getRoundState().cowboy.holeCards).toEqual(['2s', '3s']);
    expect(engine.getRoundState().phase).toBe('DEALING');
  });
});
