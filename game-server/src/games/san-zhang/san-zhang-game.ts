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
import { evaluate3, compare3 } from './san-zhang-hand';

/**
 * SanZhangGame — PLAYER-BANKED 3-card comparison (the platform never banks; it only takes a cut).
 *
 * A seated player banks the round; each other player bets an amount. Everyone is dealt 3 cards from
 * a provably-fair shuffle and each bettor's hand is compared to the banker's — beat the banker to
 * win your bet, lose it if the banker is higher, push on a tie. The banker offsets all bettors
 * (nets sum to zero); the platform takes only a rake and settles through the player-funded path.
 */

export type SanZhangPhase = 'BETTING' | 'RESOLVED';

export interface SanZhangAction {
  type: 'bet';
  amount: number;
}

export interface SanZhangGameEvents extends Record<string, unknown> {
  handResolved: { roundId: string; net: Record<string, number> };
}

export interface SanZhangGameConfig {
  rakeBps: number;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  accountOf: (playerId: string) => string;
  jackpotAccounts: JackpotAccounts;
}

export class SanZhangGame extends BaseGame<SanZhangPhase, SanZhangAction, SanZhangGameEvents> {
  readonly minPlayers = 2;
  readonly maxPlayers = 10;

  private readonly cfg: SanZhangGameConfig;
  private readonly chain: ChainClient;
  private banker: string | undefined;
  private readonly bets = new Map<string, number>();
  private readonly hands = new Map<string, string[]>();
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
    events: EventBus<SanZhangGameEvents>,
    chain: ChainClient,
    cfg: SanZhangGameConfig,
  ) {
    super(roomId, fc, events, {
      initial: 'BETTING',
      transitions: { BETTING: ['RESOLVED'], RESOLVED: ['BETTING'] },
    });
    this.cfg = cfg;
    this.chain = chain;
  }

  setBanker(playerId: string): void {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('betting is closed');
    this.banker = playerId;
    this.bets.delete(playerId);
  }

  placeBet(playerId: string, amount: number): void {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('betting is closed');
    if (amount <= 0) throw new InvalidActionError('bet must be positive');
    if (playerId === this.banker) throw new InvalidActionError('the banker cannot bet');
    this.bets.set(playerId, amount);
  }

  handleAction(playerId: string, action: SanZhangAction): void {
    if (action.type !== 'bet') throw new InvalidActionError('unknown action');
    this.placeBet(playerId, action.amount);
  }

  async start(_players: string[] = []): Promise<void> {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('hand already dealt');
    if (!this.banker) throw new InvalidActionError('no banker designated');
    if (this.bets.size === 0) throw new InvalidActionError('no bets placed');

    this.roundId = `${this.roomId}-s${++this.handCounter}`;
    const participants = [this.banker, ...this.bets.keys()];
    const { serverSeed } = generateServerCommitment();
    const seats: SeatedClientSeed[] = participants.map((_, i) => ({
      seatOrder: i,
      clientSeed: generateClientSeed(),
    }));
    const allClientSeeds = mergeClientSeeds(seats);
    const target = (await this.chain.getLatestBlockNumber()) + 1;
    const futureBlockHash = await awaitFutureBlockHash(this.chain, target);
    const finalSeed = computeFinalSeed(serverSeed, allClientSeeds, futureBlockHash, this.roundId);
    this.lastFinalSeed = finalSeed;

    // Deal 3 cards to each participant (banker first), in fixed order.
    const deck = shuffledDeck(finalSeed);
    this.hands.clear();
    participants.forEach((id, i) => {
      this.hands.set(id, [deck[3 * i]!, deck[3 * i + 1]!, deck[3 * i + 2]!]);
    });

    // Compare each bettor to the banker; banker offsets all bettors.
    const bankerRank = evaluate3(this.hands.get(this.banker)!);
    this.net = new Map();
    let bankerNet = 0;
    for (const [playerId, amount] of this.bets) {
      const cmp = compare3(evaluate3(this.hands.get(playerId)!), bankerRank);
      const g = cmp > 0 ? amount : cmp < 0 ? -amount : 0;
      this.net.set(playerId, g);
      bankerNet -= g;
    }
    this.net.set(this.banker, bankerNet);

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
    this.events.emit('handResolved', { roundId: this.roundId, net: Object.fromEntries(this.net) });
  }

  nextRound(): void {
    if (!this.sm.is('RESOLVED')) throw new InvalidActionError('current hand not resolved');
    this.bets.clear();
    this.hands.clear();
    this.net = new Map();
    this.sm.transition('BETTING');
  }

  getNet(): Map<string, number> {
    return new Map(this.net);
  }
  handOf(playerId: string): readonly string[] | undefined {
    return this.hands.get(playerId);
  }

  getPublicState(forPlayerId: string): unknown {
    const revealed = this.sm.is('RESOLVED');
    return {
      phase: this.state,
      banker: this.banker ?? null,
      yourHand: this.hands.get(forPlayerId) ?? null,
      yourNet: this.net.get(forPlayerId) ?? null,
      // At showdown all hands are revealed; before, only your own is visible.
      hands: revealed ? Object.fromEntries(this.hands) : undefined,
    };
  }
  /** The round's provably-fair seed, or undefined before the first round. */
  roundSeed(): string | undefined {
    return this.lastFinalSeed;
  }
}
