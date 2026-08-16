import { BaseGame, InvalidActionError } from '../../core/base-game';
import { EventBus } from '../../core/event-bus';
import type { FinancialCoreClient, JackpotAccounts } from '../../core/financial-core-client';
import {
  generateServerCommitment,
  generateClientSeed,
  mergeClientSeeds,
  computeFinalSeed,
  shuffle,
  type ChainClient,
  type SeatedClientSeed,
} from '../../fairness';
import { settleNet, toTableSettlementRequest } from '../texas/settlement';
import { classifyPlay, beats, ComboType, type Combo } from './combos';
import { build54Deck, cardRank } from './ddz-deck';

/**
 * DouDiZhuGame (斗地主 / Fight the Landlord) — 3 players, one Landlord vs two Peasants.
 *
 * Deal 17 cards each + 3 to the bottom, bid for the Landlord (who takes the bottom, now 20 cards),
 * then play in turn: each play must beat the current one (validated by the combo engine) or pass.
 * Empty your hand to win. The Landlord plays for double stakes; bombs and rockets double the pot.
 * Player-funded — the platform only takes a rake — settled through the shared FC path.
 */

export type DdzPhase = 'BIDDING' | 'PLAYING' | 'FINISHED';

export type DdzAction =
  | { type: 'bid'; points: number }
  | { type: 'play'; cards: string[] }
  | { type: 'pass' };

export interface DdzGameEvents extends Record<string, unknown> {
  landlordChosen: { landlord: string; bidPoints: number };
  gameFinished: { winner: string; landlord: string; net: Record<string, number> };
}

export interface DdzGameConfig {
  /** Base stake per point. */
  baseStake: number;
  rakeBps: number;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  accountOf: (playerId: string) => string;
  jackpotAccounts: JackpotAccounts;
}

/** Landlord vs Peasants payout (conserved: landlord ±2·stake, each peasant ∓stake). */
export function scoreDouDiZhu(
  landlordWins: boolean,
  landlord: string,
  players: readonly string[],
  stake: number,
): Map<string, number> {
  const net = new Map<string, number>();
  const peasants = players.filter((p) => p !== landlord);
  if (landlordWins) {
    net.set(landlord, 2 * stake);
    for (const p of peasants) net.set(p, -stake);
  } else {
    net.set(landlord, -2 * stake);
    for (const p of peasants) net.set(p, stake);
  }
  return net;
}

export class DouDiZhuGame extends BaseGame<DdzPhase, DdzAction, DdzGameEvents> {
  readonly minPlayers = 3;
  readonly maxPlayers = 3;

  private readonly cfg: DdzGameConfig;
  private readonly chain: ChainClient;
  private players: string[] = [];
  private readonly hands = new Map<string, string[]>();
  private bottom: string[] = [];
  private readonly bids = new Map<string, number>();
  private landlord: string | undefined;
  private bidPoints = 1;
  private multiplier = 1;
  private current: { combo: Combo; cards: string[]; by: string } | undefined;
  private turnIndex = 0;
  private passes = 0;
  private winner: string | undefined;
  private net = new Map<string, number>();
  private roundId = '';
  private handCounter = 0;

  constructor(
    roomId: string,
    fc: FinancialCoreClient,
    events: EventBus<DdzGameEvents>,
    chain: ChainClient,
    cfg: DdzGameConfig,
  ) {
    super(roomId, fc, events, {
      initial: 'BIDDING',
      transitions: { BIDDING: ['PLAYING'], PLAYING: ['FINISHED'], FINISHED: ['BIDDING'] },
    });
    this.cfg = cfg;
    this.chain = chain;
  }

  /** Seat exactly 3 players and deal a provably-fair board; opens bidding. */
  async start(players: string[]): Promise<void> {
    if (players.length !== 3) throw new InvalidActionError('Dou Di Zhu needs exactly 3 players');
    if (this.sm.is('FINISHED')) {
      this.sm.transition('BIDDING');
    }
    this.players = [...players];
    this.roundId = `${this.roomId}-d${++this.handCounter}`;
    this.winner = undefined;
    this.current = undefined;
    this.passes = 0;
    this.bids.clear();

    const { serverSeed } = generateServerCommitment();
    const seats: SeatedClientSeed[] = players.map((_, i) => ({
      seatOrder: i,
      clientSeed: generateClientSeed(),
    }));
    const allClientSeeds = mergeClientSeeds(seats);
    const target = (await this.chain.getLatestBlockNumber()) + 1;
    const futureBlockHash = await this.chain.getBlockHash(target);
    const finalSeed = computeFinalSeed(serverSeed, allClientSeeds, futureBlockHash, this.roundId);

    const deck = shuffle(build54Deck(), finalSeed);
    this.hands.clear();
    players.forEach((id, i) => this.hands.set(id, deck.slice(i * 17, i * 17 + 17)));
    this.bottom = deck.slice(51, 54);
    this.turnIndex = 0; // first seat bids first
  }

  private get turn(): string {
    return this.players[this.turnIndex]!;
  }
  private advanceTurn(): void {
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
  }

  bid(playerId: string, points: number): void {
    if (!this.sm.is('BIDDING')) throw new InvalidActionError('not bidding');
    if (this.turn !== playerId) throw new InvalidActionError('not your turn');
    if (!Number.isInteger(points) || points < 0 || points > 3) {
      throw new InvalidActionError('bid must be 0 (pass) to 3');
    }
    this.bids.set(playerId, points);
    if (this.bids.size === this.players.length) this.chooseLandlord();
    else this.advanceTurn();
  }

  private chooseLandlord(): void {
    let best = this.players[0]!;
    let bestPoints = -1;
    for (const p of this.players) {
      const pts = this.bids.get(p) ?? 0;
      if (pts > bestPoints) {
        bestPoints = pts;
        best = p;
      }
    }
    this.landlord = best;
    this.bidPoints = Math.max(1, bestPoints); // all-pass → forced 1
    this.hands.set(best, [...this.hands.get(best)!, ...this.bottom]);
    this.turnIndex = this.players.indexOf(best);
    this.current = undefined;
    this.passes = 0;
    this.multiplier = 1;
    this.sm.transition('PLAYING');
    this.events.emit('landlordChosen', { landlord: best, bidPoints: this.bidPoints });
  }

  async play(playerId: string, cards: string[]): Promise<void> {
    if (!this.sm.is('PLAYING')) throw new InvalidActionError('not in play');
    if (this.turn !== playerId) throw new InvalidActionError('not your turn');
    if (cards.length === 0 || new Set(cards).size !== cards.length) {
      throw new InvalidActionError('invalid card selection');
    }
    const hand = this.hands.get(playerId)!;
    if (!cards.every((c) => hand.includes(c))) throw new InvalidActionError('cards not in hand');

    const combo = classifyPlay(cards.map(cardRank));
    if (!combo) throw new InvalidActionError('not a legal combination');
    if (this.current && this.current.by !== playerId && !beats(this.current.combo, combo)) {
      throw new InvalidActionError('does not beat the current play');
    }

    this.hands.set(playerId, hand.filter((c) => !cards.includes(c)));
    if (combo.type === ComboType.Bomb || combo.type === ComboType.Rocket) this.multiplier *= 2;
    this.current = { combo, cards, by: playerId };
    this.passes = 0;

    if (this.hands.get(playerId)!.length === 0) {
      await this.finish(playerId);
    } else {
      this.advanceTurn();
    }
  }

  async pass(playerId: string): Promise<void> {
    if (!this.sm.is('PLAYING')) throw new InvalidActionError('not in play');
    if (this.turn !== playerId) throw new InvalidActionError('not your turn');
    if (!this.current || this.current.by === playerId) {
      throw new InvalidActionError('cannot pass when leading');
    }
    this.passes += 1;
    if (this.passes >= 2) {
      // Both opponents passed — control returns to the last player to make a play.
      this.turnIndex = this.players.indexOf(this.current.by);
      this.current = undefined;
      this.passes = 0;
    } else {
      this.advanceTurn();
    }
  }

  private async finish(winner: string): Promise<void> {
    this.winner = winner;
    const stake = this.cfg.baseStake * this.bidPoints * this.multiplier;
    this.net = scoreDouDiZhu(winner === this.landlord, this.landlord!, this.players, stake);
    this.sm.transition('FINISHED');
    // AWAITED, like every other game here. This was `void this.settle()`, which
    // made a financial-core outage an unhandled rejection: no caller could catch
    // it, the hand still reported as finished, and in Node 15+ an unhandled
    // rejection terminates the process — so a settlement failure at one Dou Di
    // Zhu table took down the whole game server. A settlement test caught it on
    // the first run by crashing the test runner.
    await this.settle();
  }

  private async settle(): Promise<void> {
    const settlement = settleNet(this.net, { rakeBps: this.cfg.rakeBps });
    const request = toTableSettlementRequest(settlement, {
      roundId: this.roundId,
      tableType: this.cfg.tableType,
      ...(this.cfg.leagueId ? { leagueId: this.cfg.leagueId } : {}),
      accountOf: this.cfg.accountOf,
      jackpotAccounts: this.cfg.jackpotAccounts,
    });
    await this.fc.settleTableHand(request);
    this.events.emit('gameFinished', {
      winner: this.winner!,
      landlord: this.landlord!,
      net: Object.fromEntries(this.net),
    });
  }

  async handleAction(playerId: string, action: DdzAction): Promise<void> {
    if (action.type === 'bid') this.bid(playerId, action.points);
    // Awaited, or the fix one level down is undone here: a winning play settles,
    // and an unawaited settle is the unhandled rejection this just removed.
    else if (action.type === 'play') await this.play(playerId, action.cards);
    else if (action.type === 'pass') await this.pass(playerId);
    else throw new InvalidActionError('unknown action');
  }

  // ── State ──
  getLandlord(): string | undefined {
    return this.landlord;
  }
  getTurn(): string | undefined {
    return this.sm.is('FINISHED') ? undefined : this.turn;
  }
  getWinner(): string | undefined {
    return this.winner;
  }
  getNet(): Map<string, number> {
    return new Map(this.net);
  }
  handOf(playerId: string): readonly string[] | undefined {
    return this.hands.get(playerId);
  }

  getPublicState(forPlayerId: string): unknown {
    return {
      phase: this.state,
      landlord: this.landlord ?? null,
      turn: this.getTurn() ?? null,
      currentPlay: this.current ? { cards: this.current.cards, by: this.current.by } : null,
      yourHand: this.hands.get(forPlayerId) ?? null,
      handCounts: Object.fromEntries(
        [...this.hands].map(([id, h]) => [id, h.length]),
      ),
    };
  }
}
