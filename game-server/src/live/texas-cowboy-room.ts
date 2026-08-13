import { settleNet, toTableSettlementRequest } from '../games/texas/settlement';
import { BaseLiveRoom, RoomError, tableJackpotAccounts, type BaseRoomSeat } from './base-room';
import type { LiveTableConfig, RoomDeps } from './live-room';
import type { TableSnapshot } from './room-state';
import { TexasCowboyEngine } from '../games/texas-cowboy/engine';

export interface TexasCowboyRoomConfig extends LiveTableConfig {
  game: 'texas-cowboy';
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  /** House cut, taken from the winners' share at settlement. */
  rakeBps?: number;
  bettingMs?: number;
}

interface RoomSeat extends BaseRoomSeat {
  /** Chips committed to bets this round. Held out of the stack until the round settles. */
  reserved: number;
}

/**
 * Texas Cowboy — a betting table around an automated Cowboy vs Cowgirl showdown.
 *
 * The room runs the clock and mirrors what the engine decides. It does NOT write balances: every
 * naira moves through `deps.fc.settleTableHand`, exactly like every other table here, and the
 * mirrored `seat.stack` is only ever set from a settlement the ledger has already accepted.
 *
 * Nobody banks this game, so the round is player-funded: the losing stakes are the prize pool and
 * the winners divide it. The alternative — paying published odds out of a house account — would
 * make the platform the counterparty to its own players.
 */
/** The table's cut. A table that forgets to configure one still takes the standard 5%. */
function rakeOf(config: TexasCowboyRoomConfig): number {
  return config.rakeBps ?? 500;
}

export class TexasCowboyRoom extends BaseLiveRoom<TexasCowboyRoomConfig, RoomSeat> {
  private engine: TexasCowboyEngine;
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(config: TexasCowboyRoomConfig, deps: RoomDeps) {
    super(config, deps);
    this.engine = new TexasCowboyEngine(config.id, this.handNumber, { rakeBps: rakeOf(config) });
    // Start loop immediately
    void this.enqueue(() => this.startNextRound());
  }

  protected createSeatRecord(
    seatIndex: number,
    playerId: string,
    displayName: string,
    buyIn: number,
    avatarUrl?: string
  ): RoomSeat {
    return {
      index: seatIndex,
      playerId,
      name: displayName,
      ...(avatarUrl ? { avatarUrl } : {}),
      stack: buyIn,
      bet: 0,
      reserved: 0,
      connected: this.viewers.has(playerId),
    };
  }

  protected handleAct(playerId: string, action: { type: string; amount?: number; selection?: string }): void {
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('not seated');

    if (action.type !== 'bet') throw new RoomError('invalid action');
    const amount = action.amount ?? 0;
    const marketId = action.selection; // using selection as marketId for simplicity
    if (!marketId) throw new RoomError('missing market selection');

    try {
      // The engine decides whether the bet stands — window, market, and whether these chips are
      // actually free. `reserved` holds them out of the stack until the round settles, so a second
      // bet cannot spend the same money.
      this.engine.placeBet({
        userId: playerId,
        marketId,
        amount,
        available: seat.stack - seat.reserved,
        serverTime: Date.now(),
        generateId: () => `${this.config.id}-${this.handNumber}-${this.engine.getBets().length + 1}`,
      });
      seat.reserved += amount;
      seat.bet = seat.reserved;
      this.push();
    } catch (err) {
      throw new RoomError(err instanceof Error ? err.message : 'bet rejected');
    }
  }

  protected onSeatChanged(): void {
    this.push();
  }
  
  /**
   * Queue the next phase, replacing whatever was pending.
   *
   * Overwriting the handle without clearing it left the old timer running: it survived `dispose`
   * (keeping the table alive after it was shut down) and could still fire into a round that had
   * already moved on.
   */
  private schedulePhase(fn: () => void, delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    // A closed table schedules nothing. The round loop is kicked off from the constructor's queue,
    // so a dispose() arriving first would otherwise be overtaken by the round it was shutting down.
    if (this.disposed) return;
    this.timer = setTimeout(() => void this.enqueue(fn), delayMs);
  }

  private startNextRound(): void {
    if (this.disposed) return;
    this.handNumber++;
    this.engine = new TexasCowboyEngine(this.config.id, this.handNumber, {
      rakeBps: rakeOf(this.config),
    });
    
    // Clear seat bets
    for (const s of this.occupiedSeats()) {
      s.bet = 0;
    }

    this.engine.openBetting(12000); // 12 seconds
    this.phase = 'WAITING'; // Actually BETTING_OPEN in UI
    
    // Pass deadline up to base room so snapshot includes it
    this.actionDeadline = this.engine.getRoundState().bettingWindow?.closesAt ?? null;
    this.push();

    this.schedulePhase(() => this.lockBetting(), 12000);
  }
  
  private lockBetting(): void {
    this.engine.lockBetting();
    this.actionDeadline = null;
    this.push();
    
    this.schedulePhase(() => this.dealCards(), 2000);
  }

  private dealCards(): void {
    this.phase = 'IN_HAND';
    this.engine.deal();
    this.push();
    
    this.schedulePhase(() => this.revealFlop(), 3000); // Wait for dealing animation
  }

  private revealFlop(): void {
    this.engine.revealFlop();
    this.push();
    this.schedulePhase(() => this.revealTurn(), 2500);
  }

  private revealTurn(): void {
    this.engine.revealTurn();
    this.push();
    this.schedulePhase(() => this.revealRiver(), 2500);
  }

  private revealRiver(): void {
    this.engine.revealRiver();
    this.push();
    this.schedulePhase(() => this.evaluateHands(), 2500);
  }

  private evaluateHands(): void {
    this.phase = 'SHOWDOWN';
    this.engine.evaluateHands();
    this.push();
    this.schedulePhase(() => this.settleRound(), 4000); // Let players see results
  }

  /**
   * Pay the round out through the ledger.
   *
   * The engine returns net changes that already sum to zero — losing stakes funding winning ones —
   * and `settleNet` takes the house's rake out of the winners' side, the same call every other
   * table makes. Nothing here writes a balance: `fc.settleTableHand` does that, and the seats are
   * only re-mirrored once it has accepted. If it refuses, the stacks are left exactly as they were
   * and the reservations stand, because no money moved.
   */
  private async settleRound(): Promise<void> {
    const { netByUser } = this.engine.settleBets();

    if (netByUser.size > 0) {
      const settlement = settleNet(netByUser, { rakeBps: rakeOf(this.config) });
      const request = toTableSettlementRequest(settlement, {
        roundId: `${this.config.id}-tc-${this.handNumber}`,
        tableType: 'PLATFORM',
        accountOf: (playerId) => playerId,
        jackpotAccounts: tableJackpotAccounts(this.config.id),
      });

      try {
        const receipt = await this.fc.settleTableHand(request);
        if (receipt.applied) {
          // Mirror what the ledger just did: winners up by their net, losers down by theirs.
          for (const loser of settlement.losers) {
            const seat = this.seatOf(loser.playerId);
            if (seat) seat.stack -= loser.amount;
          }
          for (const winner of settlement.winners) {
            const seat = this.seatOf(winner.playerId);
            if (seat) seat.stack += winner.amount;
          }
        }
      } catch (err) {
        // A refused settlement is not a paid one. Say so, change nothing, and let the next round
        // start — the stakes are still on the seats because they were never taken off them.
        console.error(`[room ${this.config.id}] settlement refused, nothing paid:`, err);
      }
    }

    for (const seat of this.occupiedSeats()) {
      seat.reserved = 0;
      seat.bet = 0;
    }

    this.push();
    this.schedulePhase(() => this.startNextRound(), 6000);
  }

  snapshotFor(playerId: string): TableSnapshot {
    const seat = this.seatOf(playerId);
    const roundState = this.engine.getRoundState();
    
    // The felt needs the whole public round — both hands, the markets, the betting window — so it
    // travels in `gameState`. It used to be serialised into `message`, which is the human line the
    // result banner prints, so every round painted a wall of JSON across the table.
    const result = roundState.result;
    const winnerName = result?.winner === 'COWBOY' ? 'Cowboy' : 'Cowgirl';
    const handName = (result?.winningHandType ?? '').replace(/_/g, ' ').toLowerCase();
    const headline = !result
      ? undefined
      : result.winner === 'TIE'
        ? 'Split — the hands tie'
        : `${winnerName} wins with ${handName}`;

    return {
      tableId: this.config.id,
      name: this.config.name,
      variant: 'Texas Cowboy',
      smallBlind: 0,
      bigBlind: 0,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      maxSeats: this.config.maxSeats,
      phase: this.phase,
      handId: `#${this.handNumber}`,
      handNumber: this.handNumber,
      street: null,
      pot: 0,
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

        return {
          index: s.index,
          playerId: s.playerId,
          name: s.name,
          ...(s.avatarUrl ? { avatarUrl: s.avatarUrl } : {}),
          stack: s.stack,
          bet: s.bet,
          status: 'active',
          inHand: true,
          connected: s.connected,
          isDealer: false,
          isWinner: false,
          isYou: s.playerId === playerId,
          cards: [],
        };
      }),
      insurance: null,
      jackpot: this.lastJackpotWin,
      yourSeat: seat ? seat.index : null,
      you: seat ? { playerId: seat.playerId, name: seat.name, available: seat.stack } : null,
      toActSeat: null,
      actionDeadline: this.actionDeadline,
      legal: null,
      winners: [],
      gameState: roundState,
      ...(headline ? { message: headline } : {}),
      serverTime: Date.now(),
    };
  }

  dispose(): void {
    this.disposed = true;
    super.dispose();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
