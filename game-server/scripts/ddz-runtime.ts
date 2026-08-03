import { EventBus } from '../src/core/event-bus';
import { FakeChainClient } from '../src/fairness';
import type { FinancialCoreClient } from '../src/core/financial-core-client';
import { DouDiZhuGame } from '../src/games/dou-di-zhu/dou-di-zhu-game';
import { classifyPlay, beats, type Combo } from '../src/games/dou-di-zhu/combos';
import { cardRank } from '../src/games/dou-di-zhu/ddz-deck';

/**
 * Dou Di Zhu (Landlord) runtime for the Mini App demo — YOU plus two bots.
 *
 * The bots need to play LEGALLY, so they use the same combo engine the game validates with:
 * `classifyPlay` to form a play and `beats` to check it tops the current one. A bot leads with its
 * lowest single and otherwise plays the smallest legal beat it can find, else passes. That's simple
 * but honest — no bot ever makes a move the engine wouldn't accept from a human.
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

export const YOU = 'you';
const BOTS = ['bot_li', 'bot_wang'];
const SEATS = [YOU, ...BOTS];

export interface DdzView {
  tableId: string;
  phase: string;
  landlord: string | null;
  turn: string | null;
  yourTurn: boolean;
  currentPlay: { cards: string[]; by: string } | null;
  yourHand: string[];
  handCounts: Record<string, number>;
  bidding: boolean;
  winner?: string;
  youNet?: number;
  complete: boolean;
}

interface LiveDdz {
  game: DouDiZhuGame;
  bidsDone: boolean;
}

const tables = new Map<string, LiveDdz>();
let counter = 0;

export async function createDdz(): Promise<string> {
  const game = new DouDiZhuGame(`ddz-${++counter}`, noopFc, new EventBus(), new FakeChainClient(), {
    baseStake: 10_000_000, // $10
    rakeBps: 500,
    tableType: 'PLATFORM',
    accountOf: (p): string => `acc-${p}`,
    jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
  });
  const tableId = `d${counter}`;
  await game.start(SEATS);
  tables.set(tableId, { game, bidsDone: false });
  return tableId;
}

/** You bid; the bots bid after you, then the landlord is set and play begins. */
export async function bid(tableId: string, points: number): Promise<void> {
  const t = table(tableId);
  if (t.bidsDone) throw new Error('bidding is over');
  t.game.bid(YOU, points);
  // Bots bid modestly so you usually get the landlord if you want it.
  t.game.bid(BOTS[0]!, points > 1 ? 0 : 1);
  t.game.bid(BOTS[1]!, 0);
  t.bidsDone = true;
  await driveBots(tableId);
}

export async function playCards(tableId: string, cards: string[]): Promise<void> {
  const t = table(tableId);
  t.game.play(YOU, cards);
  await driveBots(tableId);
}

export async function passTurn(tableId: string): Promise<void> {
  const t = table(tableId);
  await t.game.pass(YOU);
  await driveBots(tableId);
}

/** Let the bots act until it's your turn again (or the hand is over). */
async function driveBots(tableId: string): Promise<void> {
  const t = table(tableId);
  for (let guard = 0; guard < 200; guard++) {
    const turn = t.game.getTurn();
    if (!turn || turn === YOU || t.game.getWinner()) return;

    const hand = [...(t.game.handOf(turn) ?? [])];
    const current = currentCombo(t);
    const move = chooseBotMove(hand, current);
    if (move) t.game.play(turn, move);
    else await t.game.pass(turn);
  }
}

/** The play that must be beaten, plus how many CARDS it used (Combo itself doesn't carry that). */
interface CurrentPlay {
  combo: Combo;
  size: number;
}

function currentCombo(t: LiveDdz): CurrentPlay | null {
  const ps = t.game.getPublicState(YOU) as {
    currentPlay: { cards: string[]; by: string } | null;
  };
  if (!ps.currentPlay) return null;
  const combo = classifyPlay(ps.currentPlay.cards.map(cardRank));
  return combo ? { combo, size: ps.currentPlay.cards.length } : null;
}

/**
 * Pick a legal move: the smallest same-size group that beats the current play, or the lowest single
 * when leading. Returns null to pass.
 */
function chooseBotMove(hand: string[], current: CurrentPlay | null): string[] | null {
  const sorted = [...hand].sort((a, b) => cardRank(a) - cardRank(b));

  if (!current) return [sorted[0]!]; // leading — throw the lowest card

  // A beat must use the same number of cards, so scan every window of that size.
  for (let i = 0; i + current.size <= sorted.length; i++) {
    const candidate = sorted.slice(i, i + current.size);
    const combo = classifyPlay(candidate.map(cardRank));
    if (combo && beats(current.combo, combo)) return candidate;
  }
  return null; // nothing legal — pass
}

export function viewFor(tableId: string): DdzView {
  const t = table(tableId);
  const ps = t.game.getPublicState(YOU) as {
    phase: string;
    landlord: string | null;
    turn: string | null;
    currentPlay: { cards: string[]; by: string } | null;
    yourHand: string[] | null;
    handCounts: Record<string, number>;
  };
  const winner = t.game.getWinner();
  const view: DdzView = {
    tableId,
    phase: ps.phase,
    landlord: ps.landlord,
    turn: ps.turn,
    yourTurn: ps.turn === YOU && t.bidsDone,
    currentPlay: ps.currentPlay,
    yourHand: [...(ps.yourHand ?? [])].sort((a, b) => cardRank(b) - cardRank(a)),
    handCounts: ps.handCounts,
    bidding: !t.bidsDone,
    complete: winner !== undefined,
  };
  if (winner) {
    view.winner = winner;
    view.youNet = t.game.getNet().get(YOU) ?? 0;
  }
  return view;
}

/** Is this selection a legal play right now? Used to enable/disable the Play button. */
export function isLegalSelection(tableId: string, cards: string[]): boolean {
  const t = table(tableId);
  const combo = classifyPlay(cards.map(cardRank));
  if (!combo) return false;
  const current = currentCombo(t);
  const ps = t.game.getPublicState(YOU) as { currentPlay: { by: string } | null };
  // Leading (no current play, or you already hold the lead) → any valid combo.
  if (!current || ps.currentPlay?.by === YOU) return true;
  return cards.length === current.size && beats(current.combo, combo);
}

function table(tableId: string): LiveDdz {
  const t = tables.get(tableId);
  if (!t) throw new Error(`unknown table: ${tableId}`);
  return t;
}
