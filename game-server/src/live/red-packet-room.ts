import { EventBus } from '../core/event-bus';
import { RedPacketGame } from '../games/red-packet/red-packet-game';
import { settleNet } from '../games/texas/settlement';
import { BaseLiveRoom, RoomError, tableJackpotAccounts, type BaseRoomSeat } from './base-room';
import type { LiveTableConfig, RoomDeps } from './live-room';
import type { TableSnapshot } from './room-state';

export interface RedPacketRoomConfig extends LiveTableConfig {
  id: string;
  name: string;
  game: 'red-packet';
  size: number;
  mineCount: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  rakeBps: number;
  bettingTimeMs?: number;
  showdownDelayMs?: number;
}

interface RoomSeat extends BaseRoomSeat {
  cell?: number | undefined;
  isBanker: boolean;
}

export class RedPacketRoom extends BaseLiveRoom<RedPacketRoomConfig, RoomSeat> {
  private game: RedPacketGame;
  private bettingTimer: NodeJS.Timeout | null = null;
  private showdownTimer: NodeJS.Timeout | null = null;

  constructor(config: RedPacketRoomConfig, deps: RoomDeps) {
    super(config, deps);
    this.requireNumbers('rakeBps', 'size', 'mineCount');

    this.game = new RedPacketGame(
      config.id,
      this.fc,
      new EventBus(),
      {
        size: config.size,
        mineCount: config.mineCount,
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

    const cell = Number(action.type);
    const amount = action.amount ?? 0;
    if (isNaN(cell) || cell < 0 || cell >= this.config.size) throw new RoomError('invalid cell');
    if (amount <= 0 || amount > seat.stack) throw new RoomError('invalid bet amount');

    const banker = this.occupiedSeats().find((s) => s.isBanker);
    if (banker) {
      this.checkBankerExposure(banker, amount, 1);
    }

    seat.cell = cell;
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

    this.game = new RedPacketGame(
      this.config.id,
      this.fc,
      new EventBus(),
      {
        size: this.config.size,
        mineCount: this.config.mineCount,
        rakeBps: this.config.rakeBps,
        tableType: 'PLATFORM',
        accountOf: (p) => p,
        jackpotAccounts: tableJackpotAccounts(this.config.id),
      },
    );

    this.phase = 'IN_HAND';
    this.handNumber++;
    const duration = this.config.bettingTimeMs ?? 15_000;
    this.actionDeadline = Date.now() + duration;

    for (const s of occupied) {
      s.bet = 0;
      delete s.cell;
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
    const bettors = this.occupiedSeats().filter((s) => !s.isBanker && s.bet > 0 && s.cell !== undefined);

    if (!banker || bettors.length === 0) {
      this.phase = 'WAITING';
      this.push();
      return;
    }

    // Anything from here on can throw — the ledger refusing, a jackpot pool failing to open.
    // If it does, the table goes back to WAITING rather than sitting in IN_HAND forever. See
    // `abandonRound`: nothing is paid or reversed, only the room is made playable again.
    try {
      this.game.setBanker(banker.playerId);
      for (const b of bettors) {
        this.game.placeBet(b.playerId, b.cell!, b.bet);
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

      const roundId = `${this.config.id}-rp-${this.handNumber}`;
      // The jackpot draws on the seed the round was actually generated from, so a player can
      // verify the draw the same way they verify the game. It used to draw on `${roundId}:seed`,
      // which anyone holding a round id can reproduce — a predictable jackpot.
      //
      // No fallback on purpose: without a real seed the draw is SKIPPED, because running it on a
      // guessable one is the bug rather than the backstop.
      const jackpotSeed = this.game.reveal()?.serverSeed;
      if (jackpotSeed) {
        await this.processJackpot(winnerProfit, roundId, jackpotSeed);
      } else {
        console.error(
          `[room ${this.config.id}] round ${roundId} has no verifiable seed — jackpot skipped rather than drawn on a predictable one`,
        );
      }

    } catch (err) {
      this.abandonRound(err);
      // WAITING is not enough on its own: nothing else deals the next hand, so the table would
      // sit idle with players in their seats. Give it the same beat a showdown gets, then try.
      this.showdownTimer = setTimeout(() => {
        void this.enqueue(() => this.maybeStartRound());
      }, this.config.showdownDelayMs ?? 5_000);
      return;
    }

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
    const reveal = this.game.reveal();

    return {
      tableId: this.config.id,
      name: this.config.name,
      variant: 'Red Packet',
      smallBlind: 0,
      bigBlind: 0,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      maxSeats: this.config.maxSeats,
      phase: this.phase,
      handId: this.phase !== 'WAITING' ? `#${this.handNumber}` : null,
      handNumber: this.handNumber,
      street: null,
      // The felt draws the grid, who has claimed which packet, and what the mines were. All of it
      // is public: the picks were already going out to every viewer in `lastAction`, and the mines
      // only exist here once the round has revealed them.
      gameState: {
        size: this.config.size,
        mineCount: this.config.mineCount,
        ...(reveal ? { mines: reveal.mines } : {}),
        seats: this.occupiedSeats().map((s) => ({
          index: s.index,
          ...(s.cell !== undefined ? { cell: s.cell } : {}),
          ...(s.net !== undefined ? { net: s.net } : {}),
        })),
      },
      pot: this.occupiedSeats().reduce((sum, s) => sum + s.bet, 0),
      board: reveal ? reveal.mines.map(String) : [],
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
        if (s.isBanker) lastAction = 'BANKER';
        else if (s.bet > 0) lastAction = `CELL ${s.cell} (₮${s.bet})`;

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
      ...(reveal ? { message: `Mines: ${reveal.mines.join(', ')}` } : {}),
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
