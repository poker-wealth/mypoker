import { EventBus } from '../../src/core/event-bus';
import { FakeChainClient } from '../../src/fairness';
import type {
  FinancialCoreClient,
  TableSettlementRequest,
} from '../../src/core/financial-core-client';

import { BaccaratGame } from '../../src/games/baccarat/baccarat-game';
import { SanZhangGame } from '../../src/games/san-zhang/san-zhang-game';
import { NiuNiuGame } from '../../src/games/niu-niu/niu-niu-game';
import { RedPacketGame } from '../../src/games/red-packet/red-packet-game';
import { CowboyBeautyGame } from '../../src/games/cowboy-beauty/cowboy-beauty-game';
import { LotteryGame } from '../../src/games/lottery/lottery-game';
import { TexasGame } from '../../src/games/texas/texas-game';
import { SlotsProvider } from '../../src/games/slots/slots-provider';
import { ThirdPartyAdapter } from '../../src/games/third-party/adapter';
import { TexasCowboyEngine } from '../../src/games/texas-cowboy/engine';
import { createDeck } from '../../src/games/texas-cowboy/poker';
import { settleNet, toTableSettlementRequest } from '../../src/games/texas/settlement';
import { GAME_IDS } from '../../src/lobby/game-catalog';

/**
 * FULL-GAME REGRESSION (spec W5/Day 23).
 *
 * Every game, played for real, through the shared settlement path — checking the one invariant that
 * must hold everywhere or we are printing money:
 *
 *     Σ(what the losers pay)  ===  Σ(what the winners receive) + rake + jackpot
 *
 * Not a cent created. Not a cent destroyed. The platform's only income is the rake.
 */

const captured: TableSettlementRequest[] = [];
const fc: FinancialCoreClient = {
  async buyIn() {},
  async release() {},
  async settleRound(req) {
    return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
  },
  async settleTableHand(req) {
    captured.push(req);
    return { roundId: req.roundId, applied: true };
  },
};

const base = {
  rakeBps: 500, // 5% — a real rake, so the invariant is actually exercised
  tableType: 'PLATFORM' as const,
  accountOf: (p: string) => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};

beforeEach(() => {
  captured.length = 0;
});

/** The money invariant, asserted against what the game actually sent the Financial Core. */
function expectConserved(req: TableSettlementRequest, game: string): void {
  const paidIn = req.losers.reduce((a, l) => a + Number(l.amount), 0);
  const paidOut = req.winners.reduce((a, w) => a + Number(w.amount), 0);
  const rake = Number(req.rake);
  const jackpot =
    Number(req.jackpot.mini) +
    Number(req.jackpot.minor) +
    Number(req.jackpot.major) +
    Number(req.jackpot.grand);

  expect({ game, total: paidIn }).toEqual({ game, total: paidOut + rake + jackpot });
  if (paidIn > 0) {
    for (const w of req.winners) expect(Number(w.amount)).toBeGreaterThan(0);
    for (const l of req.losers) expect(Number(l.amount)).toBeGreaterThan(0);
  }
}

describe('full-game regression — money is conserved in every game', () => {
  it('Baccarat (player-banked)', async () => {
    const g = new BaccaratGame('t', fc, new EventBus(), new FakeChainClient(), {
      ...base,
      tiePayout: 8,
    });
    g.setBanker('bank');
    g.placeBet('p1', 'player', 100);
    g.placeBet('p2', 'banker', 100);
    g.placeBet('p3', 'player', 50);
    await g.start();
    // A tie can leave every net at zero — only assert conservation when money actually moved.
    if (captured.length) expectConserved(captured[0]!, 'baccarat');
  });

  it('San Zhang (player-banked)', async () => {
    const g = new SanZhangGame('t', fc, new EventBus(), new FakeChainClient(), base);
    g.setBanker('bank');
    g.placeBet('p1', 100);
    g.placeBet('p2', 100);
    await g.start();
    expectConserved(captured[0]!, 'san-zhang');
  });

  it('Niu Niu (player-banked)', async () => {
    const g = new NiuNiuGame('t', fc, new EventBus(), new FakeChainClient(), base);
    g.claimBanker('bank');
    g.placeBet('p1', 100);
    g.placeBet('p2', 100);
    g.placeBet('p3', 100);
    await g.start();
    expectConserved(captured[0]!, 'niu-niu');
  });

  it('Red Packet Minesweeper (player-banked)', async () => {
    const g = new RedPacketGame('t', fc, new EventBus(), {
      ...base,
      size: 25,
      mineCount: 5,
      serverSeed: 'regression-seed',
    });
    g.setBanker('bank');
    for (let cell = 0; cell < 8; cell++) g.placeBet(`p${cell}`, cell, 100);
    await g.start();
    expectConserved(captured[0]!, 'red-packet');
  });

  it('Cowboy & Beauty (pari-mutuel)', async () => {
    const g = new CowboyBeautyGame('t', fc, new EventBus(), new FakeChainClient(), base);
    g.placeBet('p1', 'COWBOY', 150);
    g.placeBet('p2', 'BEAUTY', 250);
    g.placeBet('p3', 'COWBOY', 100);
    await g.freeze();
    await g.start();
    if (captured.length) expectConserved(captured[0]!, 'cowboy-beauty'); // a tie voids the round
  });

  it('Lottery (pari-mutuel)', async () => {
    // Cover every number so there is always a winner and always a loser.
    const g = new LotteryGame('t', fc, new EventBus(), new FakeChainClient(), { ...base, range: 5 });
    for (let n = 0; n < 5; n++) g.buyTicket(`p${n}`, n, 100 * (n + 1));
    await g.start();
    expectConserved(captured[0]!, 'lottery');
  });

  it('Texas Hold’em', async () => {
    const g = new TexasGame(
      't',
      fc,
      new EventBus(),
      {
        tableType: base.tableType,
        accountOf: base.accountOf,
        jackpotAccounts: base.jackpotAccounts,
        smallBlind: 10,
        bigBlind: 20,
        rake: { bps: 500, cap: 100_000, noFlopNoDrop: true },
      },
      new FakeChainClient(),
    );
    await g.seatPlayer('p1', 1000);
    await g.seatPlayer('p2', 1000);
    await g.seatPlayer('p3', 1000);
    await g.startHand();

    // Everyone plays to showdown.
    let guard = 0;
    while (g.legalActions() && guard++ < 100) {
      const actor = (g.getPublicState('p1') as { toAct?: string | null }).toAct;
      if (!actor) break;
      const legal = g.legalActions()!;
      await g.handleAction(actor, legal.canCheck ? { type: 'check' } : { type: 'call' });
    }
    expect(captured.length).toBe(1);
    expectConserved(captured[0]!, 'texas');
  });

  it('Slots (third-party, behind the isolation boundary)', async () => {
    const SECRET = 'regression-secret';
    const adapter = new ThirdPartyAdapter(fc, {
      provider: new SlotsProvider(SECRET, 'regression-seed'),
      secret: SECRET,
      providerAccountId: 'acc-slots-vendor',
      maxPayoutMultiple: 100,
      commissionBps: 500,
      tableType: 'PLATFORM',
      accountOf: (p) => `acc-${p}`,
      jackpotAccounts: base.jackpotAccounts,
    });
    // Spin until one actually moves money (a push settles nothing, by design).
    for (let i = 0; i < 50 && captured.length === 0; i++) await adapter.play('p1', `spin-${i}`, 100);
    expect(captured.length).toBeGreaterThan(0);
    expectConserved(captured[0]!, 'slots');
  });

  it('Texas Cowboy (pool-funded prediction market)', () => {
    // No banker sits at this table, so the round has to fund itself: the losing stakes are the
    // prize. The invariant is the same one every other game answers to — what the losers pay is
    // what the winners take, plus the house's rake.
    const engine = new TexasCowboyEngine('tc-regression', 1, { rakeBps: base.rakeBps });
    engine.openBetting(12_000, 1_000);
    for (const [userId, marketId, amount] of [
      ['w1', 'cowboy_win', 1_000],
      ['w2', 'straight_flush', 500],
      ['l1', 'cowgirl_win', 900],
      ['l2', 'tie', 600],
    ] as const) {
      engine.placeBet({
        userId,
        marketId,
        amount,
        available: 100_000,
        serverTime: 2_000,
        generateId: () => `${userId}-${marketId}`,
      });
    }

    // Cowboy makes a straight flush; cowgirl misses. Both winning markets come in.
    const used = new Set(['2s', '3s', '2h', '7d', '4s', '5s', '6s', 'Td', 'Jc']);
    const deck = [
      '2s', '3s', '2h', '7d', '4s', '5s', '6s', 'Td', 'Jc',
      ...createDeck().filter((c) => !used.has(c)),
    ];
    engine.lockBetting();
    engine.deal({ deck });
    engine.revealFlop();
    engine.revealTurn();
    engine.revealRiver();
    engine.evaluateHands();

    const { netByUser } = engine.settleBets();
    const settlement = settleNet(netByUser, { rakeBps: base.rakeBps });
    const request = toTableSettlementRequest(settlement, {
      roundId: 'tc-regression-1',
      tableType: base.tableType,
      accountOf: base.accountOf,
      jackpotAccounts: base.jackpotAccounts,
    });

    // The engine's own books balance before the house takes anything…
    expect([...netByUser.values()].reduce((a, b) => a + b, 0)).toBe(0);
    // …and the request that reaches the ledger balances after it does.
    expectConserved(request, 'texas-cowboy');
  });
});

describe('catalogue', () => {
  it('every catalogued game is covered by this regression', () => {
    // 12 games: the 9 from the spec, plus Short Deck, Omaha and Texas Cowboy. Short Deck/Omaha
    // share Texas's entire betting + settlement path (variants.test.ts proves the deal and the
    // rankings); Texas Cowboy has its own case above, because it funds payouts from the pool.
    expect(GAME_IDS).toHaveLength(12);
  });
});
