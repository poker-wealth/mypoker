import { EventBus } from '../src/core/event-bus';
import { FakeChainClient } from '../src/fairness';
import type { FinancialCoreClient } from '../src/core/financial-core-client';
import { CowboyBeautyGame } from '../src/games/cowboy-beauty/cowboy-beauty-game';
import { LotteryGame } from '../src/games/lottery/lottery-game';
import { SlotsProvider } from '../src/games/slots/slots-provider';
import { ThirdPartyAdapter } from '../src/games/third-party/adapter';

/**
 * Runtime for the "fast" games in the Mini App demo — Cowboy & Beauty, Lottery, Slots.
 *
 * Each drives the real engine and normalises the result for one screen shape. Cowboy & Beauty and
 * Lottery are pari-mutuel (winners split the losers' pool — no banker, the platform only rakes), so
 * the demo adds a bot on the other side to make a real pool. Slots runs through the third-party
 * isolation wall, exactly as a real vendor would: it signs its result and can never touch our money.
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
const cfg = {
  rakeBps: 500,
  tableType: 'PLATFORM' as const,
  accountOf: (p: string): string => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};
export const YOU = 'you';

export interface FastResult {
  game: 'cowboy-beauty' | 'lottery' | 'slots';
  outcome: string;
  youNet: number;
  won: boolean;
  detail: Record<string, unknown>;
}

/** Cowboy & Beauty: you pick a side, a bot backs the other, the higher card wins. */
export async function playCowboy(side: 'COWBOY' | 'BEAUTY', amount: number): Promise<FastResult> {
  const g = new CowboyBeautyGame('demo', noopFc, new EventBus(), new FakeChainClient(), cfg);
  const other = side === 'COWBOY' ? 'BEAUTY' : 'COWBOY';
  g.placeBet(YOU, side, amount);
  g.placeBet('bot_two', other, amount); // opposing pool
  const odds = g.getOddsBps();
  await g.freeze();
  await g.start();
  const winner = g.getWinner()!;
  const cards = g.getCards()!;
  const youNet = g.getNet().get(YOU) ?? 0;
  return {
    game: 'cowboy-beauty',
    outcome: winner === 'TIE' ? 'Tie — bets returned' : `${cap(winner)} wins`,
    youNet,
    won: youNet > 0,
    detail: {
      yourSide: side,
      winner,
      cowboyCard: cards.cowboy,
      beautyCard: cards.beauty,
      oddsCowboy: (odds.COWBOY ?? 0) / 10000,
      oddsBeauty: (odds.BEAUTY ?? 0) / 10000,
      drawBlock: g.getDrawBlock(),
    },
  };
}

/** Lottery: you pick a number; bots cover the rest so there's always a pool; one number is drawn. */
export async function playLottery(pick: number, amount: number): Promise<FastResult> {
  const range = 5;
  const g = new LotteryGame('demo', noopFc, new EventBus(), new FakeChainClient(), { ...cfg, range });
  g.buyTicket(YOU, pick, amount);
  for (let n = 0; n < range; n++) if (n !== pick) g.buyTicket(`bot_${n}`, n, amount);
  await g.start();
  const winning = g.getWinningNumber()!;
  const youNet = g.getNet().get(YOU) ?? 0;
  return {
    game: 'lottery',
    outcome: `Number ${winning} drawn`,
    youNet,
    won: youNet > 0,
    detail: { yourNumber: pick, winningNumber: winning, range, pool: g.getPool() },
  };
}

/** Slots: a spin through the third-party isolation wall (the vendor signs; it never holds our money). */
const SLOTS_SECRET = 'demo-slots-secret';
let slotsRound = 0;
export async function playSlots(amount: number): Promise<FastResult> {
  const adapter = new ThirdPartyAdapter(noopFc, {
    provider: new SlotsProvider(SLOTS_SECRET),
    secret: SLOTS_SECRET,
    providerAccountId: 'acc-slots-vendor',
    maxPayoutMultiple: 100,
    commissionBps: 500,
    tableType: 'PLATFORM',
    accountOf: (p): string => `acc-${p}`,
    jackpotAccounts: cfg.jackpotAccounts,
  });
  const receipt = await adapter.play(YOU, `slots-${++slotsRound}-${amount}`, amount);
  const outcome = receipt.outcome as { reels: string[]; multiplier: number };
  return {
    game: 'slots',
    outcome: outcome.multiplier > 0 ? `${outcome.multiplier}× win!` : 'No win',
    youNet: receipt.net,
    won: receipt.net > 0,
    detail: { reels: outcome.reels, multiplier: outcome.multiplier, payout: receipt.payout },
  };
}

function cap(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
