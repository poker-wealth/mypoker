import { RedPacketGame } from '../../../src/games/red-packet/red-packet-game';
import { generateMineGrid, gridCommit } from '../../../src/games/red-packet/mine-grid';
import { EventBus } from '../../../src/core/event-bus';
import { InvalidActionError } from '../../../src/core/base-game';
import type { FinancialCoreClient } from '../../../src/core/financial-core-client';

const fc: FinancialCoreClient = {
  async buyIn() {},
  async release() {},
  async settleRound(req) {
    return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
  },
  async settleTableHand(req) {
    return { roundId: req.roundId, applied: true };
  },
};

const SEED = 'fixed-test-seed';
const SIZE = 25;
const MINES = 5;

const cfg = {
  size: SIZE,
  mineCount: MINES,
  rakeBps: 0,
  tableType: 'PLATFORM' as const,
  accountOf: (p: string) => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
  serverSeed: SEED,
};

// Known grid for the fixed seed, so tests can bet on a safe vs a mine cell.
const mineSet = generateMineGrid(SEED, SIZE, MINES);
const mineCell = [...mineSet][0]!;
const safeCell = [...Array(SIZE).keys()].find((i) => !mineSet.has(i))!;

function newGame(): RedPacketGame {
  return new RedPacketGame('rp', fc, new EventBus(), cfg);
}

describe('RedPacketGame', () => {
  it('publishes the grid commit BEFORE any bet, matching the seed', () => {
    const g = newGame();
    expect(g.getCommit()).toBe(gridCommit(SEED));
    expect(g.reveal()).toBeNull(); // seed hidden until resolved
  });

  it('safe bet wins its multiplier, mine bet loses, banker offsets, conserved', async () => {
    const g = newGame();
    g.setBanker('bank');
    g.placeBet('winner', safeCell, 100); // 25/20 = 1.25× → +25 net
    g.placeBet('loser', mineCell, 100); // mine → −100
    await g.start();

    const net = g.getNet();
    expect(net.get('winner')).toBe(25);
    expect(net.get('loser')).toBe(-100);
    expect(net.get('bank')).toBe(75); // -(25 + -100)
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);

    const revealed = g.reveal();
    expect(revealed).not.toBeNull();
    expect(revealed!.serverSeed).toBe(SEED);
    expect(gridCommit(revealed!.serverSeed)).toBe(g.getCommit()); // verifies against pre-bet commit
  });

  it('rejects banker betting, out-of-range cells, and betting after resolve', async () => {
    const g = newGame();
    g.setBanker('bank');
    expect(() => g.placeBet('bank', safeCell, 100)).toThrow(InvalidActionError);
    expect(() => g.placeBet('x', 999, 100)).toThrow(InvalidActionError);
    expect(() => g.placeBet('x', safeCell, 0)).toThrow(InvalidActionError);
    g.placeBet('x', safeCell, 100);
    await g.start();
    expect(() => g.placeBet('y', safeCell, 100)).toThrow(InvalidActionError);
  });

  it('needs a banker and at least one bet to resolve', async () => {
    const g1 = newGame();
    g1.placeBet('x', safeCell, 100);
    await expect(g1.start()).rejects.toThrow(/no banker/);
    const g2 = newGame();
    g2.setBanker('bank');
    await expect(g2.start()).rejects.toThrow(/no bets/);
  });
});
