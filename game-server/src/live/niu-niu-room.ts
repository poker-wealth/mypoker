import { EventBus } from '../core/event-bus';
import { NiuNiuGame } from '../games/niu-niu/niu-niu-game';
import { describeNiu, evaluateNiu } from '../games/niu-niu/niu-niu-hand';
import { settleNet } from '../games/texas/settlement';
import { BaseLiveRoom, RoomError, tableJackpotAccounts, type BaseRoomSeat } from './base-room';
import type { LiveTableConfig, RoomDeps } from './live-room';
import type { TableSnapshot } from './room-state';

export interface NiuNiuRoomConfig extends LiveTableConfig {
  id: string;
  name: string;
  game: 'niu-niu';
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  rakeBps: number;
  bettingTimeMs?: number;
  /** How long the bank auction runs before the highest bid takes the chair. */
  biddingTimeMs?: number;
  showdownDelayMs?: number;
}

/**
 * The public half of a Niu Niu round, sent to every viewer as `snapshot.gameState`.
 *
 * Mirrored by `NiuNiuRoundState` in frontend/src/components/games/NiuNiuFelt.tsx — the felt needs
 * the auction and the multipliers to draw the round, and none of it is hidden information.
 */
export interface NiuNiuRoundState {
  /** The winning bid: what every settlement this round is multiplied by. */
  bankerMultiplier: number;
  seats: Array<{
    index: number;
    /** What they bid for the bank, if they have bid. */
    bid?: number;
    /** The multiplier on their stake. */
    betMultiplier?: number;
    /** The hand they turned over. Present only at showdown. */
    hand?: string;
    /** Chips won or lost, once the round is settled. */
    net?: number;
  }>;
}

interface RoomSeat extends BaseRoomSeat {
  isBanker: boolean;
  /** What this seat bid for the bank this round, if they have bid. */
  bankerBid?: number;
  /** The multiplier on their stake. */
  betMultiplier?: number;
}

/** The bank auction: `bid-1` / `bid-2` / `bid-5` from the client. */
const BANKER_BIDS: Readonly<Record<string, number>> = { 'bid-1': 1, 'bid-2': 2, 'bid-5': 5 };

/** What a bettor may multiply their stake by. */
const BET_MULTIPLIERS = [1, 2, 5];

/**
 * The best hand on the ladder pays six times (Five Small), so that is what the bank must be able to
 * cover on every bet in front of it — the stake alone is not the exposure.
 */
const MAX_HAND_MULTIPLIER = 6;

/**
 * Niu Niu / Bull Bull — one game, one table, real chips.
 *
 * The round runs as an auction and then a betting window: players bid 1x, 2x or 5x for the bank,
 * the highest bid takes the chair, and that bid multiplies every settlement of the round. Bettors
 * stake against the banker with their own 1x/2x/5x, and the winning HAND's multiplier applies on
 * top — a bomb against a 5x bank is worth many times a flat win.
 *
 * This is the bull-bull betting structure on the niu niu hand ladder; they were the same game
 * played by two sets of rules in two places, and this is the one that settles through `deps.fc`.
 */
export class NiuNiuRoom extends BaseLiveRoom<NiuNiuRoomConfig, RoomSeat> {
  private readonly game: NiuNiuGame;
  private bettingTimer: NodeJS.Timeout | null = null;
  private showdownTimer: NodeJS.Timeout | null = null;
  /** Which half of the round we are in: the bank auction, or betting against the winner of it. */
  private stage: 'BIDDING' | 'BETTING' | null = null;
  private bankerMultiplier = 1;

  constructor(config: NiuNiuRoomConfig, deps: RoomDeps) {
    super(config, deps);
    this.requireNumbers('rakeBps');

    this.game = new NiuNiuGame(
      config.id,
      this.fc,
      new EventBus(),
      this.chain,
      {
        rakeBps: config.rakeBps,
        tableType: 'PLATFORM',
        accountOf: (p) => p,
        jackpotAccounts: tableJackpotAccounts(config.id),
      },
    );
  }

  protected createSeatRecord(
    seatIndex: number,
    playerId: string,
    displayName: string,
    buyIn: number,
    avatarUrl?: string,
    isFirst?: boolean,
  ): RoomSeat {
    return {
      index: seatIndex,
      playerId,
      name: displayName,
      ...(avatarUrl ? { avatarUrl } : {}),
      stack: buyIn,
      bet: 0,
      connected: this.viewers.has(playerId),
      isBanker: Boolean(isFirst),
    };
  }

  protected handleAct(playerId: string, action: { type: string; amount?: number; multiplier?: number }): void {
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('not seated');

    // ── The auction ───────────────────────────────────────────────────────────
    // Bid for the bank rather than racing to claim it: the highest bid takes the chair, and that
    // bid becomes the multiplier on every settlement of the round.
    const bid = BANKER_BIDS[action.type];
    if (bid !== undefined) {
      if (this.stage !== 'BIDDING') throw new RoomError('the auction is closed');
      seat.bankerBid = bid;
      this.push();
      if (this.occupiedSeats().every((s) => s.bankerBid !== undefined)) {
        if (this.bettingTimer) clearTimeout(this.bettingTimer);
        this.bettingTimer = null;
        void this.enqueue(() => this.openBetting());
      }
      return;
    }

    if (action.type !== 'bet') throw new RoomError(`unknown action: ${action.type}`);
    if (this.phase !== 'IN_HAND' || this.stage !== 'BETTING') {
      throw new RoomError('betting is closed');
    }
    if (seat.isBanker) throw new RoomError('banker cannot bet');

    const amount = action.amount ?? 0;
    const multiplier = action.multiplier ?? 1;
    if (!BET_MULTIPLIERS.includes(multiplier)) throw new RoomError('bet multiplier must be 1x, 2x or 5x');
    if (amount <= 0 || amount > seat.stack) throw new RoomError('invalid bet amount');

    const banker = this.occupiedSeats().find((s) => s.isBanker);
    if (banker) {
      // What this bet can actually cost the bank: the stake, the bettor's multiplier, the bank's
      // own winning bid, and the best hand the bettor could turn over (Five Small, 6x).
      const exposure = multiplier * this.bankerMultiplier * MAX_HAND_MULTIPLIER;
      this.checkBankerExposure(banker, amount, exposure, seat.index);
      seat.maxMultiplier = exposure;
    }

    seat.bet = amount;
    seat.betMultiplier = multiplier;
    this.push();

    const nonBankers = this.occupiedSeats().filter((s) => !s.isBanker);
    if (nonBankers.length > 0 && nonBankers.every((s) => s.bet > 0)) {
      if (this.bettingTimer) clearTimeout(this.bettingTimer);
      this.bettingTimer = null;
      void this.enqueue(() => this.resolveRound());
    }
  }

  /** Close the auction: the highest bid takes the bank, and betting opens against it. */
  private openBetting(): void {
    if (this.stage !== 'BIDDING') return;
    const seated = this.occupiedSeats();
    if (seated.length < 2) {
      this.phase = 'WAITING';
      this.stage = null;
      this.push();
      return;
    }

    // Highest bid wins; an unbid seat counts as 1x, and the earliest of equal bids takes it.
    let winner = seated[0]!;
    for (const s of seated) {
      if ((s.bankerBid ?? 1) > (winner.bankerBid ?? 1)) winner = s;
    }
    for (const s of seated) s.isBanker = s === winner;
    this.bankerMultiplier = winner.bankerBid ?? 1;

    this.stage = 'BETTING';
    const duration = this.config.bettingTimeMs ?? 15_000;
    this.actionDeadline = Date.now() + duration;
    this.push();

    this.bettingTimer = setTimeout(() => {
      void this.enqueue(() => this.resolveRound());
    }, duration);
  }

  protected onSeatChanged(): void {
    this.maybeStartRound();
  }

  /** Open the bank auction. Betting comes after it, against whoever wins the chair. */
  private maybeStartRound(): void {
    if (this.phase !== 'WAITING') return;
    const occupied = this.occupiedSeats();
    if (occupied.length < 2) return;

    this.phase = 'IN_HAND';
    this.stage = 'BIDDING';
    this.handNumber++;
    this.bankerMultiplier = 1;

    for (const s of occupied) {
      s.bet = 0;
      s.isBanker = false;
      delete s.bankerBid;
      delete s.betMultiplier;
      // Left behind, last round's exposure is counted against this round's bank.
      delete s.maxMultiplier;
      delete s.net;
    }

    const duration = this.config.biddingTimeMs ?? 8_000;
    this.actionDeadline = Date.now() + duration;
    this.push();

    // Nobody has to bid. When the clock runs out, unbid seats count as 1x and the bank goes to the
    // highest — which, if nobody bid at all, is the first seat at 1x.
    this.bettingTimer = setTimeout(() => {
      void this.enqueue(() => this.openBetting());
    }, duration);
  }

  private async resolveRound(): Promise<void> {
    if (this.phase !== 'IN_HAND') return;
    if (this.bettingTimer) clearTimeout(this.bettingTimer);
    this.bettingTimer = null;
    this.actionDeadline = null;

    const banker = this.occupiedSeats().find((s) => s.isBanker);
    const bettors = this.occupiedSeats().filter((s) => !s.isBanker && s.bet > 0);

    if (!banker || bettors.length === 0) {
      this.phase = 'WAITING';
      this.stage = null;
      this.push();
      return;
    }

    this.game.claimBanker(banker.playerId, this.bankerMultiplier);
    for (const b of bettors) {
      this.game.placeBet(b.playerId, b.bet, b.betMultiplier ?? 1);
    }

    await this.game.start();

    const grossNets = this.game.getNet();
    const settlement = settleNet(grossNets, { rakeBps: this.config.rakeBps });
    const netDeltas = new Map<string, number>();
    for (const l of settlement.losers) netDeltas.set(l.playerId, -l.amount);
    for (const w of settlement.winners) netDeltas.set(w.playerId, w.amount);

    let winnerProfit = 0;
    for (const s of this.occupiedSeats()) {
      const net = netDeltas.get(s.playerId) ?? 0;
      s.net = net;
      s.stack += net;
      if (net > 0) winnerProfit += net;
    }

    const roundId = `${this.config.id}-nn-${this.handNumber}`;
    await this.processJackpot(winnerProfit, roundId, `${roundId}:seed`);

    this.phase = 'SHOWDOWN';
    this.push();

    this.showdownTimer = setTimeout(() => {
      void this.enqueue(() => {
        this.game.nextRound();
        this.phase = 'WAITING';
        this.stage = null;
        this.push();
        this.maybeStartRound();
      });
    }, this.config.showdownDelayMs ?? 5_000);
  }

  snapshotFor(playerId: string): TableSnapshot {
    const seat = this.seatOf(playerId);

    return {
      tableId: this.config.id,
      name: this.config.name,
      variant: 'Niu Niu',
      smallBlind: 0,
      bigBlind: 0,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      maxSeats: this.config.maxSeats,
      phase: this.phase,
      handId: this.phase !== 'WAITING' ? `#${this.handNumber}` : null,
      handNumber: this.handNumber,
      street: null,
      ...(this.stage ? { stage: this.stage } : {}),
      gameState: this.publicRound(),
      pot: this.occupiedSeats().reduce((sum, s) => sum + s.bet, 0),
      board: [],
      seats: this.seats.map((s, idx) => {
        if (!s) {
          return {
            index: idx,
            playerId: '',
            name: '',
            stack: 0,
            bet: 0,
            status: 'sittingout',
            inHand: false,
            connected: false,
            isDealer: false,
            isWinner: false,
            isYou: false,
            cards: [],
          };
        }
        const cards = this.phase === 'SHOWDOWN' || s.playerId === playerId
          ? (this.game.handOf(s.playerId) as string[] ?? [])
          : Array.from({ length: 5 }, () => null);

        let lastAction: string | undefined;
        if (s.isBanker) lastAction = 'BANKER';
        else if (s.bet > 0) lastAction = `BET ₮${s.bet}`;

        return {
          index: s.index,
          playerId: s.playerId,
          name: s.name,
          ...(s.avatarUrl ? { avatarUrl: s.avatarUrl } : {}),
          stack: s.stack,
          bet: s.bet,
          status: s.bet > 0 || s.isBanker ? 'active' : 'waiting',
          inHand: this.phase !== 'WAITING',
          connected: s.connected,
          isDealer: s.isBanker,
          isWinner: (s.net ?? 0) > 0,
          isYou: s.playerId === playerId,
          cards,
          ...(lastAction ? { lastAction } : {}),
        };
      }),
      insurance: null,
      jackpot: this.lastJackpotWin,
      yourSeat: seat ? seat.index : null,
      you: seat ? { playerId: seat.playerId, name: seat.name, available: seat.stack } : null,
      toActSeat: null,
      actionDeadline: this.actionDeadline,
      legal: null,
      winners: this.occupiedSeats().filter((s) => (s.net ?? 0) > 0).map((s) => s.index),
      ...(this.waitingFor(2) ? { message: this.waitingFor(2)! } : {}),
      serverTime: Date.now(),
    };
  }

  /**
   * The round as every viewer may see it: who bid what for the bank, who staked at which multiple,
   * and — only once the hands are face up — what each of them actually turned over.
   *
   * Public means public. A hand name before showdown would tell the table what a face-down hand is
   * worth, so nothing is named here until `SHOWDOWN`.
   */
  private publicRound(): NiuNiuRoundState {
    const shown = this.phase === 'SHOWDOWN';
    return {
      bankerMultiplier: this.bankerMultiplier,
      seats: this.occupiedSeats().map((s) => {
        const hand = shown ? this.game.handOf(s.playerId) : undefined;
        return {
          index: s.index,
          ...(s.bankerBid !== undefined ? { bid: s.bankerBid } : {}),
          ...(s.betMultiplier !== undefined ? { betMultiplier: s.betMultiplier } : {}),
          ...(hand?.length ? { hand: describeNiu(evaluateNiu(hand)) } : {}),
          ...(s.net !== undefined ? { net: s.net } : {}),
        };
      }),
    };
  }

  dispose(): void {
    super.dispose();
    if (this.bettingTimer) clearTimeout(this.bettingTimer);
    if (this.showdownTimer) clearTimeout(this.showdownTimer);
  }
}
