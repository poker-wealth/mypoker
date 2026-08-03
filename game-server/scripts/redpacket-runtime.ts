import { randomBytes, createHash } from 'node:crypto';
import { EventBus } from '../src/core/event-bus';
import type { FinancialCoreClient } from '../src/core/financial-core-client';
import { RedPacketGame } from '../src/games/red-packet/red-packet-game';
import { safeMultiplierBps } from '../src/games/red-packet/mine-grid';

/**
 * Red Packet Minesweeper runtime for the Mini App demo.
 *
 * The whole point of this game is the ORDER: the mine grid is committed (its hash published) BEFORE
 * you bet, so the mines can't be moved to make you lose. So the flow is two steps:
 *   1. `newRound()` — fixes the grid and returns its commit hash. You see this BEFORE betting.
 *   2. `reveal()` — you've picked a cell and staked; the seed is revealed, the mines shown, and the
 *      revealed seed hashes back to the commit from step 1. A bot banks the round (never the house).
 */

const noopFc: FinancialCoreClient = {
  async buyIn() {},
  async release() {},
  async settleRound(req) {
    return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
  },
  async settleTableHand(req) {
    return { roundId: req.roundId, applied: true };
  },
};

const SIZE = 25; // 5×5
const MINES = 5;
const rounds = new Map<string, { seed: string; used: boolean }>();
let counter = 0;

export interface RedPacketRound {
  roundId: string;
  commit: string; // published BEFORE any bet
  size: number;
  mineCount: number;
  multiplier: number; // safe-cell payout multiple
}

export function newRound(): RedPacketRound {
  const seed = randomBytes(32).toString('hex');
  const roundId = `rp${++counter}`;
  rounds.set(roundId, { seed, used: false });
  return {
    roundId,
    commit: createHash('sha256').update(seed).digest('hex'),
    size: SIZE,
    mineCount: MINES,
    multiplier: safeMultiplierBps(SIZE, MINES) / 10000,
  };
}

export interface RedPacketReveal {
  roundId: string;
  yourCell: number;
  hit: boolean; // stepped on a mine?
  mines: number[];
  youNet: number;
  commit: string;
  serverSeed: string; // revealed — hashes back to commit
  size: number;
  mineCount: number;
}

export async function reveal(roundId: string, cell: number, amount: number): Promise<RedPacketReveal> {
  const round = rounds.get(roundId);
  if (!round) throw new Error('unknown or expired round');
  if (round.used) throw new Error('round already revealed');
  round.used = true;

  const g = new RedPacketGame(roundId, noopFc, new EventBus(), {
    size: SIZE,
    mineCount: MINES,
    rakeBps: 500,
    tableType: 'PLATFORM',
    accountOf: (p): string => `acc-${p}`,
    jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
    serverSeed: round.seed,
  });
  const commit = g.getCommit();
  g.setBanker('bot_banker');
  g.placeBet('you', cell, amount);
  await g.start();
  const rev = g.reveal()!;

  return {
    roundId,
    yourCell: cell,
    hit: rev.mines.includes(cell),
    mines: rev.mines,
    youNet: g.getNet().get('you') ?? 0,
    commit,
    serverSeed: rev.serverSeed,
    size: SIZE,
    mineCount: MINES,
  };
}
