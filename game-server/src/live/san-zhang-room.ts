import { EventBus } from '../core/event-bus';
import { SanZhangGame } from '../games/san-zhang/san-zhang-game';
import { settleNet } from '../games/texas/settlement';
import { BaseLiveRoom, RoomError, tableJackpotAccounts, type BaseRoomSeat } from './base-room';
import type { LiveTableConfig, RoomDeps } from './live-room';
import type { TableSnapshot } from './room-state';

export interface SanZhangRoomConfig extends LiveTableConfig {
  id: string;
  name: string;
  game: 'san-zhang';
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  rakeBps: number;
  bettingTimeMs?: number;
  showdownDelayMs?: number;
}

interface RoomSeat extends BaseRoomSeat {
  isBanker: boolean;
}

export class SanZhangRoom extends BaseLiveRoom<SanZhangRoomConfig, RoomSeat> {
  private readonly game: SanZhangGame;
  private bettingTimer: NodeJS.Timeout | null = null;
  private showdownTimer: NodeJS.Timeout | null = null;

  constructor(config: SanZhangRoomConfig, deps: RoomDeps) {
    super(config, deps);
    this.requireNumbers('rakeBps');

    this.game = new SanZhangGame(
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

  protected handleAct(playerId: string, action: { type: string; amount?: number }): void {
    if (this.phase !== 'IN_HAND') throw new RoomError('betting is closed');
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('not seated');
    if (seat.isBanker) throw new RoomError('banker cannot bet');

    const amount = action.amount ?? 0;
    if (amount <= 0 || amount > seat.stack) throw new RoomError('invalid bet amount');

    const banker = this.occupiedSeats().find((s) => s.isBanker);
    if (banker) {
      this.checkBankerExposure(banker, amount, 1);
    }

    seat.bet = amount;
    this.push();

    const nonBankers = this.occupiedSeats().filter((s) => !s.isBanker);
    if (nonBankers.length > 0 && nonBankers.every((s) => s.bet > 0)) {
      if (this.bettingTimer) clearTimeout(this.bettingTimer);
      this.bettingTimer = null;
      void this.enqueue(() => this.resolveRound());
    }
  }

  protected onSeatChanged(): void {
    this.maybeStartRound();
  }

  private maybeStartRound(): void {
    if (this.phase !== 'WAITING') return;
    const occupied = this.occupiedSeats();
    if (occupied.length < 2) return;

    let banker = occupied.find((s) => s.isBanker);
    if (!banker) {
      banker = occupied[0]!;
      banker.isBanker = true;
    }

    this.phase = 'IN_HAND';
    this.handNumber++;
    const duration = this.config.bettingTimeMs ?? 15_000;
    this.actionDeadline = Date.now() + duration;

    for (const s of occupied) {
      s.bet = 0;
      delete s.net;
    }

    this.push();

    this.bettingTimer = setTimeout(() => {
      void this.enqueue(() => this.resolveRound());
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
      this.push();
      return;
    }

    this.game.setBanker(banker.playerId);
    for (const b of bettors) {
      this.game.placeBet(b.playerId, b.bet);
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

    const roundId = `${this.config.id}-sz-${this.handNumber}`;
    await this.processJackpot(winnerProfit, roundId, `${roundId}:seed`);

    this.phase = 'SHOWDOWN';
    this.push();

    this.showdownTimer = setTimeout(() => {
      void this.enqueue(() => {
        this.game.nextRound();
        this.phase = 'WAITING';
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
      variant: 'San Zhang',
      smallBlind: 0,
      bigBlind: 0,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      maxSeats: this.config.maxSeats,
      phase: this.phase,
      handId: this.phase !== 'WAITING' ? `#${this.handNumber}` : null,
      handNumber: this.handNumber,
      street: null,
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
          : Array.from({ length: 3 }, () => null);

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

  dispose(): void {
    super.dispose();
    if (this.bettingTimer) clearTimeout(this.bettingTimer);
    if (this.showdownTimer) clearTimeout(this.showdownTimer);
  }
}
