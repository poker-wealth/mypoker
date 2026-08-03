import { EventBus } from '../src/core/event-bus';
import { FakeChainClient } from '../src/fairness';
import type { FinancialCoreClient } from '../src/core/financial-core-client';
import { BaccaratGame, type BetType } from '../src/games/baccarat/baccarat-game';
import { NiuNiuGame } from '../src/games/niu-niu/niu-niu-game';
import { SanZhangGame } from '../src/games/san-zhang/san-zhang-game';

/**
 * Runtime for the player-banked betting games in the Mini App demo — Baccarat, Niu Niu, San Zhang.
 *
 * They share one shape: a BOT banks the round (the platform never does — our rule), YOU place a bet,
 * the hand deals from a provably-fair shuffle, and you win or lose against the banker. This drives
 * the real engines and normalises their results into one shape the betting-table screen can render.
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

export type BettingGameId = 'baccarat' | 'niu-niu' | 'san-zhang';
export const YOU = 'you';
const BANKER = 'bot_banker';
const OTHER = 'bot_two';

export interface RevealSeat {
  id: string;
  label: string;
  cards: string[];
  isYou: boolean;
  isBanker: boolean;
}

export interface BettingResult {
  game: BettingGameId;
  outcome: string; // human-readable ("Banker wins", "You have Niu 7", …)
  youNet: number; // your money result (micro-USD)
  won: boolean;
  banker: string;
  reveal: RevealSeat[];
  /** Bet options this game offers (for the screen to render). */
  betOptions: { id: string; label: string }[];
}

/** What each game lets you bet ON. */
export function betOptionsFor(game: BettingGameId): { id: string; label: string }[] {
  if (game === 'baccarat') {
    return [
      { id: 'player', label: 'Player' },
      { id: 'banker', label: 'Banker' },
      { id: 'tie', label: 'Tie (8×)' },
    ];
  }
  // Niu Niu / San Zhang: you just back your own hand against the banker.
  return [{ id: 'hand', label: 'Back my hand' }];
}

/**
 * Play one round: place your bet, deal, and return the normalised result.
 * `side` is the Baccarat bet type; ignored by the other games.
 */
export async function playBetting(
  game: BettingGameId,
  amount: number,
  side: string,
): Promise<BettingResult> {
  const events = new EventBus();
  const chain = new FakeChainClient();

  if (game === 'baccarat') {
    const g = new BaccaratGame('demo', noopFc, events, chain, { ...cfg, tiePayout: 8 });
    g.setBanker(BANKER);
    g.placeBet(YOU, side as BetType, amount);
    await g.start();
    const r = g.getResult()!;
    const youNet = g.getNet().get(YOU) ?? 0;
    const outcomeLabel = { PLAYER: 'Player wins', BANKER: 'Banker wins', TIE: 'Tie' }[r.outcome];
    return {
      game,
      outcome: outcomeLabel,
      youNet,
      won: youNet > 0,
      banker: BANKER,
      reveal: [
        { id: 'player', label: 'Player', cards: r.playerCards, isYou: false, isBanker: false },
        { id: 'banker', label: 'Banker', cards: r.bankerCards, isYou: false, isBanker: true },
      ],
      betOptions: betOptionsFor(game),
    };
  }

  if (game === 'niu-niu') {
    const g = new NiuNiuGame('demo', noopFc, events, chain, cfg);
    g.claimBanker(BANKER);
    g.placeBet(YOU, amount);
    g.placeBet(OTHER, amount); // a second bettor so the table has 3 (min players)
    await g.start();
    return normalizeHands(game, g.getPublicState(YOU), g.getNet().get(YOU) ?? 0);
  }

  // san-zhang
  const g = new SanZhangGame('demo', noopFc, events, chain, cfg);
  g.setBanker(BANKER);
  g.placeBet(YOU, amount);
  g.placeBet(OTHER, amount);
  await g.start();
  return normalizeHands(game, g.getPublicState(YOU), g.getNet().get(YOU) ?? 0);
}

/** Niu Niu / San Zhang share a public-state shape: { banker, hands: {id: cards} }. */
function normalizeHands(game: BettingGameId, publicState: unknown, youNet: number): BettingResult {
  const ps = publicState as { banker: string; hands?: Record<string, string[]> };
  const hands = ps.hands ?? {};
  const label = (id: string): string =>
    id === YOU ? 'You' : id === ps.banker ? 'Banker' : id.replace('bot_', 'Player ');
  const reveal: RevealSeat[] = Object.entries(hands).map(([id, cards]) => ({
    id,
    label: label(id),
    cards,
    isYou: id === YOU,
    isBanker: id === ps.banker,
  }));
  // Banker first, you second, then others.
  reveal.sort((a, b) => Number(b.isBanker) - Number(a.isBanker) || Number(b.isYou) - Number(a.isYou));
  return {
    game,
    outcome: youNet > 0 ? 'You beat the banker' : youNet < 0 ? 'The banker wins' : 'Push',
    youNet,
    won: youNet > 0,
    banker: ps.banker,
    reveal,
    betOptions: betOptionsFor(game),
  };
}
