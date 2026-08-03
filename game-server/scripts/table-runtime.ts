import { EventBus } from '../src/core/event-bus';
import {
  FakeChainClient,
  InMemoryMerkleStore,
  MerkleAggregator,
  computeRoundHash,
  verifyRound,
} from '../src/fairness';
import type { FinancialCoreClient } from '../src/core/financial-core-client';
import { TexasGame } from '../src/games/texas/texas-game';
import type { Action } from '../src/games/texas/betting';
import { variant } from '../src/games/texas/variants';

/**
 * A live Texas table for the Mini App demo — YOU plus two bots, driven by the real TexasGame engine.
 *
 * The frontend only ever sees `viewFor(seat)`, which is the engine's own per-seat public state: your
 * hole cards, never an opponent's. Bots act automatically (check when they can, otherwise call/fold)
 * so a single human can play a full hand. When the hand ends, the same 6-step fairness proof the
 * verifier uses is attached, so the table can show "verify this hand" inline.
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

export interface TableView {
  tableId: string;
  variantName: string;
  phase: string;
  community: string[];
  pot: number;
  toAct: string | null;
  yourTurn: boolean;
  you: { hole: string[] | null; stack: number };
  seats: { id: string; stack: number; isYou: boolean; isBot: boolean }[];
  legal: {
    canFold: boolean;
    canCheck: boolean;
    callAmount: number | null;
    minRaiseTo: number | null;
    maxRaiseTo: number | null;
  } | null;
  complete: boolean;
  result?: {
    payouts: { id: string; net: number }[];
    showdown: { id: string; hole: string[]; best: string[]; hand: string }[];
    fairness?: unknown;
  };
}

interface LiveTable {
  game: TexasGame;
  variantName: string;
  variantId: TableVariantId;
  chain: FakeChainClient;
  startingStacks: Map<string, number>;
  /** Computed once when the hand completes, then served to every poll. */
  cachedResult?: TableView['result'];
}

const tables = new Map<string, LiveTable>();
let counter = 0;

export type TableVariantId = 'texas' | 'short-deck' | 'omaha';

export function createTable(variantId: TableVariantId = 'texas'): string {
  const chain = new FakeChainClient();
  const v = variant(variantId);
  const game = new TexasGame(
    `demo-${++counter}`,
    noopFc,
    new EventBus(),
    {
      smallBlind: 1_000_000, // $1
      bigBlind: 2_000_000, // $2
      tableType: 'PLATFORM',
      accountOf: (p): string => `acc-${p}`,
      jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
      rake: { bps: 500, cap: 100_000_000, noFlopNoDrop: true },
      ...(variantId !== 'texas' ? { variant: v } : {}),
    },
    chain,
  );
  const tableId = `t${counter}`;
  tables.set(tableId, { game, chain, variantName: v.name, variantId, startingStacks: new Map() });
  return tableId;
}

export async function startHand(tableId: string): Promise<void> {
  const t = table(tableId);
  const buyIn = 200_000_000; // $200
  await t.game.seatPlayer(YOU, buyIn);
  for (const b of BOTS) await t.game.seatPlayer(b, buyIn);
  t.startingStacks = t.game.seatedStacks();
  await t.game.startHand();
  await driveBots(tableId);
}

/** Apply your action, then let the bots respond up to your next turn (or hand end). */
export async function act(tableId: string, action: Action): Promise<void> {
  const t = table(tableId);
  const state = t.game.getPublicState(YOU) as { toAct: string | null };
  if (state.toAct !== YOU) throw new Error('not your turn');
  await t.game.handleAction(YOU, action);
  await driveBots(tableId);
}

/** Bots act (check if possible, else call; fold only when calling is impossible) until it's you or done. */
async function driveBots(tableId: string): Promise<void> {
  const t = table(tableId);
  for (let guard = 0; guard < 200; guard++) {
    const legal = t.game.legalActions();
    const state = t.game.getPublicState(YOU) as { toAct: string | null; phase: string };
    if (!legal || !state.toAct || state.toAct === YOU) break;

    const bot = state.toAct;
    const move: Action = legal.canCheck
      ? { type: 'check' }
      : legal.callAmount !== null
        ? { type: 'call' }
        : { type: 'fold' };
    await t.game.handleAction(bot, move);
  }
  await maybeCacheResult(tableId);
}

/** When the hand has settled, compute the showdown + fairness proof once and cache it. */
async function maybeCacheResult(tableId: string): Promise<void> {
  const t = table(tableId);
  const settled = t.game.settledResult();
  if (!settled || t.cachedResult) return;

  t.cachedResult = {
    payouts: [...settled.payouts].map(([id, net]) => ({ id, net })),
    showdown: settled.showdown.map((e) => ({
      id: e.id,
      hole: [...e.hole],
      best: e.rank.cards,
      hand: categoryName(e.rank.category),
    })),
    fairness: await fairnessProof(t),
  };
}

export function viewFor(tableId: string): TableView {
  const t = table(tableId);
  const s = t.game.getPublicState(YOU) as {
    phase: string;
    community: string[];
    pot: number;
    toAct: string | null;
    you: { hole: string[] | null; stack: number };
    seats: { id: string; stack: number }[];
  };
  const legal = s.toAct === YOU ? t.game.legalActions() : null;
  const complete = t.cachedResult !== undefined;

  const view: TableView = {
    tableId,
    variantName: t.variantName,
    phase: s.phase,
    community: complete ? t.game.settledResult()!.community : s.community,
    pot: s.pot,
    toAct: s.toAct,
    yourTurn: s.toAct === YOU,
    you: s.you,
    seats: s.seats.map((seat) => ({
      id: seat.id,
      stack: seat.stack,
      isYou: seat.id === YOU,
      isBot: BOTS.includes(seat.id),
    })),
    legal,
    complete,
  };
  if (t.cachedResult) view.result = t.cachedResult;
  return view;
}

const CATEGORY = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];
function categoryName(category: number): string {
  return CATEGORY[category] ?? 'Unknown';
}

/** The 6-step fairness proof for the just-played hand — the same verifier a player would run. */
async function fairnessProof(t: LiveTable): Promise<unknown> {
  const round = t.game.roundInfo();
  if (!round) return null;
  const timestamp = 0; // stable for the demo (real timestamps come from the settlement receipt)
  // The proof commits the FULL deck this variant actually dealt (Short Deck is 36 cards, not 52).
  const deckFor = (seed: string): string[] => variant(t.variantId).deckFor(seed);
  const cards = deckFor(round.finalSeed);
  const roundHash = computeRoundHash({
    roundId: round.roundId,
    serverCommit: round.serverCommit,
    allClientSeeds: round.allClientSeeds,
    futureBlockHash: round.futureBlockHash,
    finalSeed: round.finalSeed,
    cards,
    timestamp,
  });
  const store = new InMemoryMerkleStore();
  const agg = new MerkleAggregator(t.chain, store, 100);
  await agg.addRound(round.roundId, roundHash);
  await agg.flush();
  const rec = store.get(round.roundId);
  return {
    serverCommit: round.serverCommit,
    serverSeed: round.serverSeed,
    futureBlockHash: round.futureBlockHash,
    finalSeed: round.finalSeed,
    merkleRoot: rec?.merkleRoot ?? null,
    verified: verifyRound({
      roundId: round.roundId,
      serverSeed: round.serverSeed,
      serverCommit: round.serverCommit,
      allClientSeeds: round.allClientSeeds,
      futureBlockHash: round.futureBlockHash,
      finalSeed: round.finalSeed,
      cards,
      timestamp,
      roundHash,
      merkleProof: rec?.merkleProof ?? [],
      merkleRoot: rec?.merkleRoot ?? '',
      seatedClientSeeds: round.seats,
      deckFor,
    }).allPass,
  };
}

function table(tableId: string): LiveTable {
  const t = tables.get(tableId);
  if (!t) throw new Error(`unknown table: ${tableId}`);
  return t;
}
