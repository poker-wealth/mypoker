import { BaseGame, InvalidActionError } from '../../core/base-game';
import { EventBus } from '../../core/event-bus';
import type { FinancialCoreClient, JackpotAccounts } from '../../core/financial-core-client';
import {
  generateServerCommitment,
  generateClientSeed,
  mergeClientSeeds,
  computeFinalSeed,
  awaitFutureBlockHash,
  shuffledDeck,
  type ChainClient,
  type SeatedClientSeed,
} from '../../fairness';
import { settleNet, toTableSettlementRequest } from '../texas/settlement';
import { playBaccarat, type BaccaratOutcome, type BaccaratResult } from './baccarat-hand';

/**
 * BaccaratGame — PLAYER-BANKED (the platform is never the banker; it only takes a cut).
 *
 * One seated player is the banker for the round; the others bet on Player / Banker / Tie and win or
 * lose against that banker player (banker's net = −Σ bettor nets, so all player nets sum to zero).
 * The hand is dealt from a provably-fair shuffle and resolved by the fixed rules. The platform's
 * only income is a rake on winnings; settlement goes through the same player-funded path as Texas.
 */

export type BaccaratPhase = 'BETTING' | 'RESOLVED';
export type BetType = 'player' | 'banker' | 'tie';

export interface BaccaratAction {
  type: 'bet';
  betType: BetType;
  amount: number;
}

export interface BaccaratGameEvents extends Record<string, unknown> {
  handResolved: { roundId: string; outcome: BaccaratOutcome; net: Record<string, number> };
}

export interface BaccaratGameConfig {
  /** Platform cut on winnings, in basis points (e.g. 500 = 5%). */
  rakeBps: number;
  /** Tie payout multiplier (8 = 8:1). */
  tiePayout: number;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  accountOf: (playerId: string) => string;
  jackpotAccounts: JackpotAccounts;
}

interface Bet {
  betType: BetType;
  amount: number;
}

/** A bettor's GROSS result vs the banker (no platform cut here — the cut is a rake at settlement). */
export function grossResult(bet: Bet, outcome: BaccaratOutcome, tiePayout: number): number {
  switch (bet.betType) {
    case 'player':
      return outcome === 'PLAYER' ? bet.amount : outcome === 'TIE' ? 0 : -bet.amount;
    case 'banker':
      return outcome === 'BANKER' ? bet.amount : outcome === 'TIE' ? 0 : -bet.amount;
    case 'tie':
      return outcome === 'TIE' ? bet.amount * tiePayout : -bet.amount;
  }
}

export class BaccaratGame extends BaseGame<BaccaratPhase, BaccaratAction, BaccaratGameEvents> {
  readonly minPlayers = 2; // a banker + at least one bettor
  readonly maxPlayers = 12;

  private readonly cfg: BaccaratGameConfig;
  private readonly chain: ChainClient;
  private banker: string | undefined;
  private readonly bets = new Map<string, Bet>();
  private result: BaccaratResult | undefined;
  private net = new Map<string, number>();
  private roundId = '';
  /**
   * The seed this round was actually generated from — server seed, every client seed and a
   * future block hash, mixed. Kept rather than dropped so the jackpot can draw on it: the room
   * used to fall back to `${roundId}:seed`, which any player can reproduce from a round id.
   */
  private lastFinalSeed: string | undefined;
  private handCounter = 0;

  constructor(
    roomId: string,
    fc: FinancialCoreClient,
    events: EventBus<BaccaratGameEvents>,
    chain: ChainClient,
    cfg: BaccaratGameConfig,
  ) {
    super(roomId, fc, events, {
      initial: 'BETTING',
      transitions: { BETTING: ['RESOLVED'], RESOLVED: ['BETTING'] },
    });
    this.cfg = cfg;
    this.chain = chain;
  }

  /** Designate the player who banks this round. */
  setBanker(playerId: string): void {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('betting is closed');
    this.banker = playerId;
    this.bets.delete(playerId); // the banker does not place a bet
  }

  placeBet(playerId: string, betType: BetType, amount: number): void {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('betting is closed');
    if (amount <= 0) throw new InvalidActionError('bet must be positive');
    if (playerId === this.banker) throw new InvalidActionError('the banker cannot bet');
    this.bets.set(playerId, { betType, amount });
  }

  handleAction(playerId: string, action: BaccaratAction): void {
    if (action.type !== 'bet') throw new InvalidActionError('unknown action');
    this.placeBet(playerId, action.betType, action.amount);
  }

  /** Close betting, deal a provably-fair hand, resolve nets vs the banker, and settle via the FC. */
  async start(_players: string[] = []): Promise<void> {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('hand already dealt');
    if (!this.banker) throw new InvalidActionError('no banker designated');
    if (this.bets.size === 0) throw new InvalidActionError('no bets placed');

    this.roundId = `${this.roomId}-b${++this.handCounter}`;
    const { serverSeed } = generateServerCommitment();
    const seats: SeatedClientSeed[] = [...this.bets.keys()].map((_, i) => ({
      seatOrder: i,
      clientSeed: generateClientSeed(),
    }));
    const allClientSeeds = mergeClientSeeds(seats);
    const target = (await this.chain.getLatestBlockNumber()) + 1;
    const futureBlockHash = await awaitFutureBlockHash(this.chain, target);
    const finalSeed = computeFinalSeed(serverSeed, allClientSeeds, futureBlockHash, this.roundId);
    this.lastFinalSeed = finalSeed;

    this.result = playBaccarat(shuffledDeck(finalSeed));

    // Gross net per party: bettors vs the banker player. Banker offsets the bettors (sum = 0).
    this.net = new Map();
    let bankerNet = 0;
    for (const [playerId, bet] of this.bets) {
      const g = grossResult(bet, this.result.outcome, this.cfg.tiePayout);
      this.net.set(playerId, g);
      bankerNet -= g;
    }
    this.net.set(this.banker, bankerNet);

    // Platform takes only a rake (+ jackpot) on winnings; settle through the player-funded path.
    const settlement = settleNet(this.net, { rakeBps: this.cfg.rakeBps });
    const request = toTableSettlementRequest(settlement, {
      roundId: this.roundId,
      tableType: this.cfg.tableType,
      ...(this.cfg.leagueId ? { leagueId: this.cfg.leagueId } : {}),
      accountOf: this.cfg.accountOf,
      jackpotAccounts: this.cfg.jackpotAccounts,
    });
    await this.fc.settleTableHand(request);

    this.sm.transition('RESOLVED');
    this.events.emit('handResolved', {
      roundId: this.roundId,
      outcome: this.result.outcome,
      net: Object.fromEntries(this.net),
    });
  }

  nextRound(): void {
    if (!this.sm.is('RESOLVED')) throw new InvalidActionError('current hand not resolved');
    this.bets.clear();
    this.result = undefined;
    this.net = new Map();
    this.sm.transition('BETTING');
  }

  getResult(): BaccaratResult | undefined {
    return this.result;
  }
  getNet(): Map<string, number> {
    return new Map(this.net);
  }

  getPublicState(forPlayerId: string): unknown {
    const revealed = this.sm.is('RESOLVED') && this.result;
    return {
      phase: this.state,
      banker: this.banker ?? null,
      yourBet: this.bets.get(forPlayerId) ?? null,
      yourNet: this.net.get(forPlayerId) ?? null,
      outcome: revealed ? this.result!.outcome : null,
      playerCards: revealed ? this.result!.playerCards : [],
      bankerCards: revealed ? this.result!.bankerCards : [],
    };
  }
  /** The round's provably-fair seed, or undefined before the first round. */
  roundSeed(): string | undefined {
    return this.lastFinalSeed;
  }
}
