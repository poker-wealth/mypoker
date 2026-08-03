import { BaseGame, InvalidActionError } from '../../core/base-game';
import { EventBus } from '../../core/event-bus';
import type { FinancialCoreClient, JackpotAccounts } from '../../core/financial-core-client';
import {
  generateServerCommitment,
  generateClientSeed,
  mergeClientSeeds,
  computeFinalSeed,
  shuffledDeck,
  type ChainClient,
  type SeatedClientSeed,
} from '../../fairness';
import { settleNet, toTableSettlementRequest } from '../texas/settlement';
import { evaluateNiu, compareNiu } from './niu-niu-hand';

/**
 * NiuNiuGame — PLAYER-BANKED (the platform never banks; it only takes a cut).
 *
 * Players compete to bank the round: the first to claim the banker seat wins it (atomic, like a
 * Redis SETNX — exactly one of several simultaneous claims succeeds; the rest are rejected). Each
 * other player bets. Everyone is dealt 5 cards from a provably-fair shuffle; each bettor's Niu hand
 * is compared to the banker's, and the WINNING hand's payout multiplier applies. The banker offsets
 * all bettors (nets sum to zero); the platform takes only a rake and settles via the player-funded path.
 */

export type NiuNiuPhase = 'BETTING' | 'RESOLVED';

export interface NiuNiuAction {
  type: 'claim-banker' | 'bet';
  amount?: number;
}

export interface NiuNiuGameEvents extends Record<string, unknown> {
  handResolved: { roundId: string; net: Record<string, number> };
}

export interface NiuNiuGameConfig {
  rakeBps: number;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  accountOf: (playerId: string) => string;
  jackpotAccounts: JackpotAccounts;
}

export class BankerTakenError extends InvalidActionError {
  constructor() {
    super('the banker seat is already taken');
  }
}

export class NiuNiuGame extends BaseGame<NiuNiuPhase, NiuNiuAction, NiuNiuGameEvents> {
  readonly minPlayers = 2;
  readonly maxPlayers = 10;

  private readonly cfg: NiuNiuGameConfig;
  private readonly chain: ChainClient;
  private banker: string | undefined;
  private readonly bets = new Map<string, number>();
  private readonly hands = new Map<string, string[]>();
  private net = new Map<string, number>();
  private roundId = '';
  private handCounter = 0;

  constructor(
    roomId: string,
    fc: FinancialCoreClient,
    events: EventBus<NiuNiuGameEvents>,
    chain: ChainClient,
    cfg: NiuNiuGameConfig,
  ) {
    super(roomId, fc, events, {
      initial: 'BETTING',
      transitions: { BETTING: ['RESOLVED'], RESOLVED: ['BETTING'] },
    });
    this.cfg = cfg;
    this.chain = chain;
  }

  /**
   * Claim the banker seat. Atomic (single-threaded check-and-set == Redis SETNX): the first caller
   * wins; any later caller is rejected until the round resets.
   */
  claimBanker(playerId: string): void {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('betting is closed');
    if (this.banker !== undefined) throw new BankerTakenError();
    this.banker = playerId;
    this.bets.delete(playerId);
  }

  placeBet(playerId: string, amount: number): void {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('betting is closed');
    if (amount <= 0) throw new InvalidActionError('bet must be positive');
    if (playerId === this.banker) throw new InvalidActionError('the banker cannot bet');
    this.bets.set(playerId, amount);
  }

  handleAction(playerId: string, action: NiuNiuAction): void {
    if (action.type === 'claim-banker') this.claimBanker(playerId);
    else if (action.type === 'bet') this.placeBet(playerId, action.amount ?? 0);
    else throw new InvalidActionError('unknown action');
  }

  async start(_players: string[] = []): Promise<void> {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('hand already dealt');
    if (!this.banker) throw new InvalidActionError('no banker claimed');
    if (this.bets.size === 0) throw new InvalidActionError('no bets placed');

    this.roundId = `${this.roomId}-n${++this.handCounter}`;
    const participants = [this.banker, ...this.bets.keys()];
    const { serverSeed } = generateServerCommitment();
    const seats: SeatedClientSeed[] = participants.map((_, i) => ({
      seatOrder: i,
      clientSeed: generateClientSeed(),
    }));
    const allClientSeeds = mergeClientSeeds(seats);
    const target = (await this.chain.getLatestBlockNumber()) + 1;
    const futureBlockHash = await this.chain.getBlockHash(target);
    const finalSeed = computeFinalSeed(serverSeed, allClientSeeds, futureBlockHash, this.roundId);

    const deck = shuffledDeck(finalSeed);
    this.hands.clear();
    participants.forEach((id, i) => {
      this.hands.set(id, deck.slice(5 * i, 5 * i + 5));
    });

    // Compare each bettor to the banker; the winning hand's multiplier applies.
    const bankerRank = evaluateNiu(this.hands.get(this.banker)!);
    this.net = new Map();
    let bankerNet = 0;
    for (const [playerId, amount] of this.bets) {
      const bettorRank = evaluateNiu(this.hands.get(playerId)!);
      const cmp = compareNiu(bettorRank, bankerRank);
      const g = cmp > 0 ? amount * bettorRank.multiplier : -amount * bankerRank.multiplier;
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
    this.banker = undefined;
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
  getBanker(): string | undefined {
    return this.banker;
  }

  getPublicState(forPlayerId: string): unknown {
    const revealed = this.sm.is('RESOLVED');
    return {
      phase: this.state,
      banker: this.banker ?? null,
      yourHand: this.hands.get(forPlayerId) ?? null,
      yourNet: this.net.get(forPlayerId) ?? null,
      hands: revealed ? Object.fromEntries(this.hands) : undefined,
    };
  }
}
