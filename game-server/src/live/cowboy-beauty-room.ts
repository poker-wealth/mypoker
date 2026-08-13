import { EventBus } from '../core/event-bus';
import { CowboyBeautyGame } from '../games/cowboy-beauty/cowboy-beauty-game';
import type { Side } from '../games/cowboy-beauty/odds';
import { settleNet } from '../games/texas/settlement';
import { BaseLiveRoom, RoomError, tableJackpotAccounts, type BaseRoomSeat } from './base-room';
import type { LiveTableConfig, RoomDeps } from './live-room';
import type { TableSnapshot } from './room-state';

export interface CowboyBeautyRoomConfig extends LiveTableConfig {
  id: string;
  name: string;
  game: 'cowboy-beauty';
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  rakeBps: number;
  bettingTimeMs?: number;
  freezeDurationMs?: number;
  showdownDelayMs?: number;
}

interface RoomSeat extends BaseRoomSeat {
  side?: Side | undefined;
}

export class CowboyBeautyRoom extends BaseLiveRoom<CowboyBeautyRoomConfig, RoomSeat> {
  private game: CowboyBeautyGame;
  private bettingTimer: NodeJS.Timeout | null = null;
  private freezeTimer: NodeJS.Timeout | null = null;
  private showdownTimer: NodeJS.Timeout | null = null;

  constructor(config: CowboyBeautyRoomConfig, deps: RoomDeps) {
    super(config, deps);

    this.game = new CowboyBeautyGame(
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
  ): RoomSeat {
    return {
      index: seatIndex,
      playerId,
      name: displayName,
      ...(avatarUrl ? { avatarUrl } : {}),
      stack: buyIn,
      bet: 0,
      connected: this.viewers.has(playerId),
    };
  }

  protected handleAct(playerId: string, action: { type: string; amount?: number }): void {
    if (this.phase !== 'IN_HAND') throw new RoomError('betting is closed');
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('not seated');

    const side = action.type.toUpperCase() as Side;
    if (!['COWBOY', 'BEAUTY'].includes(side)) throw new RoomError('invalid side');
    const amount = action.amount ?? 0;
    if (amount <= 0 || amount > seat.stack) throw new RoomError('invalid bet amount');

    seat.side = side;
    seat.bet = amount;
    this.push();
  }

  protected onSeatChanged(): void {
    this.maybeStartRound();
  }

  private maybeStartRound(): void {
    if (this.phase !== 'WAITING') return;
    const occupied = this.occupiedSeats();
    if (occupied.length < 2) return;

    this.game = new CowboyBeautyGame(
      this.config.id,
      this.fc,
      new EventBus(),
      this.chain,
      {
        rakeBps: this.config.rakeBps,
        tableType: 'PLATFORM',
        accountOf: (p) => p,
        jackpotAccounts: tableJackpotAccounts(this.config.id),
      },
    );

    this.phase = 'IN_HAND';
    this.handNumber++;
    const bettingDuration = this.config.bettingTimeMs ?? 10_000;
    const freezeDuration = this.config.freezeDurationMs ?? 5_000;
    this.actionDeadline = Date.now() + bettingDuration;

    for (const s of occupied) {
      s.bet = 0;
      delete s.side;
      delete s.net;
    }

    this.push();

    this.bettingTimer = setTimeout(() => {
      void this.enqueue(() => this.freezeOdds(freezeDuration));
    }, bettingDuration);
  }

  private async freezeOdds(freezeDuration: number): Promise<void> {
    if (this.phase !== 'IN_HAND') return;
    const bettorSeats = this.occupiedSeats().filter((s) => s.bet > 0 && s.side !== undefined);

    if (bettorSeats.length === 0) {
      this.phase = 'WAITING';
      this.push();
      return;
    }

    for (const b of bettorSeats) {
      this.game.placeBet(b.playerId, b.side!, b.bet);
    }

    await this.game.freeze();
    this.actionDeadline = Date.now() + freezeDuration;
    this.push();

    this.freezeTimer = setTimeout(() => {
      void this.enqueue(() => this.resolveRound());
    }, freezeDuration);
  }

  private async resolveRound(): Promise<void> {
    if (this.bettingTimer) clearTimeout(this.bettingTimer);
    if (this.freezeTimer) clearTimeout(this.freezeTimer);
    this.bettingTimer = null;
    this.freezeTimer = null;
    this.actionDeadline = null;

    await this.game.start();

    const grossNets = this.game.getNet();
    let winnerProfit = 0;
    if (grossNets.size > 0) {
      const settlement = settleNet(grossNets, { rakeBps: this.config.rakeBps });
      const netDeltas = new Map<string, number>();
      for (const l of settlement.losers) netDeltas.set(l.playerId, -l.amount);
      for (const w of settlement.winners) netDeltas.set(w.playerId, w.amount);

      for (const s of this.occupiedSeats()) {
        const net = netDeltas.get(s.playerId) ?? 0;
        s.net = net;
        s.stack += net;
        if (net > 0) winnerProfit += net;
      }
    }

    const roundId = `${this.config.id}-cb-${this.handNumber}`;
    await this.processJackpot(winnerProfit, roundId, `${roundId}:seed`);

    this.phase = 'SHOWDOWN';
    this.push();

    this.showdownTimer = setTimeout(() => {
      void this.enqueue(() => {
        this.phase = 'WAITING';
        this.push();
        this.maybeStartRound();
      });
    }, this.config.showdownDelayMs ?? 5_000);
  }

  snapshotFor(playerId: string): TableSnapshot {
    const seat = this.seatOf(playerId);
    const cards = this.game.getCards();
    const winner = this.game.getWinner();

    return {
      tableId: this.config.id,
      name: this.config.name,
      variant: 'Cowboy & Beauty',
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
      board: cards && this.phase === 'SHOWDOWN' ? [cards.cowboy, cards.beauty] : [],
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

        let lastAction: string | undefined;
        if (s.bet > 0 && s.side) lastAction = `${s.side} ₮${s.bet}`;

        return {
          index: s.index,
          playerId: s.playerId,
          name: s.name,
          ...(s.avatarUrl ? { avatarUrl: s.avatarUrl } : {}),
          stack: s.stack,
          bet: s.bet,
          status: s.bet > 0 ? 'active' : 'waiting',
          inHand: this.phase !== 'WAITING',
          connected: s.connected,
          isDealer: false,
          isWinner: (s.net ?? 0) > 0,
          isYou: s.playerId === playerId,
          cards: [],
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
      ...(winner && this.phase === 'SHOWDOWN'
        ? { message: `Winner: ${winner}` }
        : {}),
      serverTime: Date.now(),
    };
  }

  dispose(): void {
    super.dispose();
    if (this.bettingTimer) clearTimeout(this.bettingTimer);
    if (this.freezeTimer) clearTimeout(this.freezeTimer);
    if (this.showdownTimer) clearTimeout(this.showdownTimer);
  }
}
