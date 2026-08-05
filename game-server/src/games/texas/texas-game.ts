import { BaseGame, InvalidActionError } from '../../core/base-game';
import { EventBus } from '../../core/event-bus';
import type { FinancialCoreClient, JackpotAccounts } from '../../core/financial-core-client';
import {
  generateServerCommitment,
  generateClientSeed,
  mergeClientSeeds,
  computeFinalSeed,
  type ChainClient,
  type SeatedClientSeed,
} from '../../fairness';
import { TexasHand, type HandResult } from './texas-hand';
import type { PokerVariant } from './variants';
import { computeSettlement, toTableSettlementRequest, type RakeConfig } from './settlement';
import type { Action, SeatPublic, Street } from './betting';

/**
 * TexasGame — a complete, networkable Texas Hold'em table on the game framework.
 *
 * Manages seated players and their chip stacks across hands. Each hand: generate a fresh
 * provably-fair seed (server commit + every seat's client seed + a future block hash), deal via
 * TexasHand, drive the betting, then settle the money through the Financial Core. Honors the three
 * iron rules — clients only read `getPublicState` (their own hole cards) and send actions the server
 * validates; state changes go through the StateMachine; money moves only via the FC client.
 *
 * This is the reusable template the other games follow.
 */

export type TexasPhase = 'WAITING' | 'IN_HAND' | 'SETTLING';

export interface TexasGameEvents extends Record<string, unknown> {
  handStarted: { roundId: string; button: number };
  handSettled: { roundId: string; payouts: Record<string, number> };
}

export interface TexasGameConfig {
  smallBlind: number;
  bigBlind: number;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  rake: RakeConfig;
  jackpotAccounts: JackpotAccounts;
  /** Map a table seat id to its Financial Core account id. */
  accountOf: (playerId: string) => string;
  /**
   * Which Hold'em variant this table deals — Texas (default), Short Deck, or Omaha. Only the deck,
   * the hole-card count and the hand ranking change; betting, side pots and settlement are shared.
   */
  variant?: PokerVariant;
}

interface Seat {
  id: string;
  stack: number;
}

interface RoundContext {
  roundId: string;
  serverSeed: string;
  serverCommit: string;
  seats: SeatedClientSeed[];
  allClientSeeds: string;
  futureBlockHash: string;
  finalSeed: string;
  button: number;
}

export class TexasGame extends BaseGame<TexasPhase, Action, TexasGameEvents> {
  readonly minPlayers = 2;
  readonly maxPlayers = 9;

  private readonly table: Seat[] = [];
  private readonly cfg: TexasGameConfig;
  private readonly chain: ChainClient;
  private hand: TexasHand | undefined;
  private round: RoundContext | undefined;
  private handCounter = 0;
  /** The result of the most recently settled hand — for showdown reveal in a client. */
  private lastResult: HandResult | undefined;

  constructor(
    roomId: string,
    fc: FinancialCoreClient,
    events: EventBus<TexasGameEvents>,
    cfg: TexasGameConfig,
    chain: ChainClient,
  ) {
    super(roomId, fc, events, {
      initial: 'WAITING',
      transitions: { WAITING: ['IN_HAND'], IN_HAND: ['SETTLING'], SETTLING: ['WAITING'] },
    });
    this.cfg = cfg;
    this.chain = chain;
  }

  /** Seat a player with a buy-in — locks their funds in the Financial Core. */
  async seatPlayer(playerId: string, chips: number): Promise<void> {
    if (this.table.some((s) => s.id === playerId)) return;
    if (this.table.length >= this.maxPlayers) throw new InvalidActionError('table full');
    await this.fc.buyIn(this.cfg.accountOf(playerId), String(chips));
    this.table.push({ id: playerId, stack: chips });
  }

  /** Begin a hand with the currently seated players (BaseGame contract). */
  async start(_players: string[]): Promise<void> {
    await this.startHand(this.handCounter % Math.max(1, this.table.length));
  }

  async startHand(button = 0): Promise<void> {
    if (this.table.length < this.minPlayers) throw new InvalidActionError('not enough players');
    if (!this.sm.is('WAITING')) throw new InvalidActionError('a hand is already in progress');

    const roundId = `${this.roomId}-h${++this.handCounter}`;
    const { serverSeed, serverCommit } = generateServerCommitment();
    const seats: SeatedClientSeed[] = this.table.map((_, i) => ({
      seatOrder: i,
      clientSeed: generateClientSeed(),
    }));
    const allClientSeeds = mergeClientSeeds(seats);
    const target = (await this.chain.getLatestBlockNumber()) + 1;
    const futureBlockHash = await this.chain.getBlockHash(target);
    const finalSeed = computeFinalSeed(serverSeed, allClientSeeds, futureBlockHash, roundId);

    this.round = {
      roundId,
      serverSeed,
      serverCommit,
      seats,
      allClientSeeds,
      futureBlockHash,
      finalSeed,
      button,
    };
    this.hand = new TexasHand(
      this.table.map((s) => ({ id: s.id, stack: s.stack })),
      {
        seed: finalSeed,
        smallBlind: this.cfg.smallBlind,
        bigBlind: this.cfg.bigBlind,
        buttonIndex: button,
        ...(this.cfg.variant ? { variant: this.cfg.variant } : {}),
      },
    );
    this.sm.transition('IN_HAND');
    this.events.emit('handStarted', { roundId, button });
  }

  async handleAction(playerId: string, action: Action): Promise<void> {
    if (!this.sm.is('IN_HAND') || !this.hand) throw new InvalidActionError('no hand in progress');
    this.hand.act(playerId, action);
    if (this.hand.isComplete) await this.settle();
  }

  private async settle(): Promise<void> {
    this.sm.transition('SETTLING');
    const hand = this.hand!;
    const round = this.round!;
    const result = hand.getResult()!;

    const settlement = computeSettlement({
      payouts: result.payouts,
      contributions: hand.contributions(),
      rake: this.cfg.rake,
      flopSeen: result.community.length >= 3,
    });
    const request = toTableSettlementRequest(settlement, {
      roundId: round.roundId,
      tableType: this.cfg.tableType,
      ...(this.cfg.leagueId ? { leagueId: this.cfg.leagueId } : {}),
      accountOf: this.cfg.accountOf,
      jackpotAccounts: this.cfg.jackpotAccounts,
    });
    await this.fc.settleTableHand(request);

    // Reflect the NET outcome in the seated chip stacks (rake + jackpot have left the table).
    const net = new Map<string, number>();
    for (const w of settlement.winners) net.set(w.playerId, w.amount);
    for (const l of settlement.losers) net.set(l.playerId, -l.amount);
    for (const seat of this.table) seat.stack += net.get(seat.id) ?? 0;

    this.lastResult = result;
    this.sm.transition('WAITING');
    this.events.emit('handSettled', {
      roundId: round.roundId,
      payouts: Object.fromEntries(result.payouts),
    });
  }

  /** The most recently settled hand's result (community, showdown, payouts) — undefined before any. */
  settledResult(): HandResult | undefined {
    return this.lastResult;
  }

  getPublicState(forPlayerId: string): unknown {
    return {
      phase: this.state,
      community: this.hand?.community() ?? [],
      pot: this.hand?.pot ?? 0,
      toAct: this.hand?.toAct ?? null,
      you: {
        hole: this.hand?.holeCardsFor(forPlayerId) ?? null, // only the requester's own cards
        stack: this.table.find((s) => s.id === forPlayerId)?.stack ?? 0,
      },
      // Opponents: stack + status only — never their hole cards.
      seats: this.table.map((s) => ({ id: s.id, stack: s.stack })),
    };
  }

  /** Legal actions for the player to act (what the client may offer). */
  legalActions(): ReturnType<TexasHand['legalActions']> | null {
    return this.hand ? this.hand.legalActions() : null;
  }

  /**
   * Per-seat betting detail for the current (or just-finished) hand — status and chips committed,
   * which a live table needs to draw bets in front of each seat. Empty before the first hand.
   */
  handSeats(): SeatPublic[] {
    return this.hand ? this.hand.seats() : [];
  }

  /** The street the current hand is on, or null before the first hand. */
  handStreet(): Street | null {
    return this.hand ? this.hand.street : null;
  }

  /** Which seat index (into the seated order) holds the button this hand. */
  buttonIndex(): number {
    return this.round?.button ?? 0;
  }

  /** Provably-fair round data for the current/last hand (for verification + the client). */
  roundInfo(): RoundContext | undefined {
    return this.round;
  }

  seatedStacks(): Map<string, number> {
    return new Map(this.table.map((s) => [s.id, s.stack]));
  }
}
