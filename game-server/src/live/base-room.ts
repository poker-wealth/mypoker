import type { FinancialCoreClient, JackpotAccounts } from '../core/financial-core-client';
import { FakeChainClient, type ChainClient } from '../fairness';
import type { JackpotCandidate } from '../jackpot/weights';
import type { GameId } from '../lobby/game-catalog';
import type { LiveRoom, LiveTableConfig, RoomDeps } from './live-room';
import type { PlayerDirectory } from './players';
import type { RoomPhase, TableCommand, TableSnapshot, TableSummary, JackpotWinSnapshot } from './room-state';

export interface BaseRoomConfig extends LiveTableConfig {
  id: string;
  name: string;
  game: GameId;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  spectatorDelayMs?: number;
  maxSpectators?: number;
}

export interface BaseRoomSeat {
  index: number;
  playerId: string;
  name: string;
  avatarUrl?: string;
  stack: number;
  bet: number;
  net?: number | undefined;
  connected: boolean;
  isBanker?: boolean;
}

export class RoomError extends Error {}

export function tableJackpotAccounts(tableId: string): JackpotAccounts {
  return {
    mini: `jp:mini:${tableId}`,
    minor: `jp:minor:${tableId}`,
    major: `jp:major:${tableId}`,
    grand: `jp:grand:${tableId}`,
  };
}

export const CHIPS_TO_MICROS = 1_000_000;

const VARIANT_NAMES: Record<string, string> = {
  baccarat: 'Baccarat',
  'niu-niu': 'Niu Niu',
  'san-zhang': 'San Zhang',
  'red-packet': 'Red Packet',
  'cowboy-beauty': 'Cowboy & Beauty',
  'dou-di-zhu': 'Dou Di Zhu',
  lottery: 'Lottery',
  slots: 'Slots',
};

import { RoomJackpot } from './room-jackpot';

export abstract class BaseLiveRoom<TConfig extends BaseRoomConfig, TSeat extends BaseRoomSeat> implements LiveRoom {
  protected readonly config: TConfig;
  protected readonly directory: PlayerDirectory;
  protected readonly fc: FinancialCoreClient;
  protected readonly chain: ChainClient;
  protected readonly seats: (TSeat | null)[];
  protected readonly viewers = new Map<string, Set<{ sendSnapshot: (s: TableSnapshot) => void }>>();

  protected phase: RoomPhase = 'WAITING';
  protected handNumber = 0;
  protected actionDeadline: number | null = null;
  protected lastJackpotWin: JackpotWinSnapshot | null = null;

  private readonly roomJackpot: RoomJackpot;
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(config: TConfig, deps: RoomDeps) {
    this.config = config;
    this.directory = deps.directory;
    this.fc = deps.fc;
    this.chain = deps.chain ?? new FakeChainClient();
    this.seats = Array.from({ length: config.maxSeats }, () => null);
    this.roomJackpot = new RoomJackpot(config.id);

    this.requireNumbers('minBuyIn', 'maxBuyIn', 'maxSeats');
    if (config.minBuyIn > config.maxBuyIn) {
      throw new RoomError(`table ${config.id}: minBuyIn ${config.minBuyIn} exceeds maxBuyIn ${config.maxBuyIn}`);
    }
    if (config.maxSeats < 1) throw new RoomError(`table ${config.id}: maxSeats must be at least 1`);
  }

  /**
   * Refuse to open a table whose money settings are not numbers.
   *
   * A missing `rakeBps` does not fail here by itself — it fails much later as `NaN` inside a
   * settlement request, surfacing as "bad settlement amount: NaN" from the ledger with nothing to
   * say which table caused it. A table that needs a figure should say so at construction, by name.
   */
  protected requireNumbers(...keys: string[]): void {
    for (const key of keys) {
      const value = (this.config as unknown as Record<string, unknown>)[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RoomError(
          `table ${this.config.id} (${this.config.game}): ${key} must be a number, got ${String(value)}`,
        );
      }
    }
  }

  protected enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const res = this.queue.then(
      () => task(),
      (err) => {
        console.error(`[room ${this.config.id}] Queue task failed:`, err);
        return task();
      },
    );
    this.queue = res.catch(() => {});
    return res;
  }

  join(playerId: string, client: { sendSnapshot: (s: TableSnapshot) => void }): () => void {
    const spectatorCount = this.viewers.size - this.occupiedSeats().length;
    if (!this.seatOf(playerId) && spectatorCount >= (this.config.maxSpectators ?? 20)) {
      throw new RoomError('max spectators reached');
    }
    let set = this.viewers.get(playerId);
    if (!set) {
      set = new Set();
      this.viewers.set(playerId, set);
    }
    set.add(client);

    const seat = this.seatOf(playerId);
    if (seat) {
      seat.connected = true;
      const timer = this.disconnectTimers.get(playerId);
      if (timer) {
        clearTimeout(timer);
        this.disconnectTimers.delete(playerId);
      }
    }

    client.sendSnapshot(this.snapshotFor(playerId));

    return (): void => {
      const s = this.viewers.get(playerId);
      s?.delete(client);
      if (s && s.size === 0) {
        this.viewers.delete(playerId);
        const mine = this.seatOf(playerId);
        if (mine) {
          mine.connected = false;
          if (this.phase === 'WAITING') {
            this.armDisconnectGrace(mine.playerId);
          }
        }
      }
    };
  }

  protected armDisconnectGrace(playerId: string, graceMs = 30_000): void {
    if (this.disconnectTimers.has(playerId)) return;
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      void this.enqueue(async () => {
        const seat = this.seatOf(playerId);
        if (seat && !seat.connected && this.phase === 'WAITING') {
          await this.releaseSeat(seat.index);
          this.push();
        }
      });
    }, graceMs);
    this.disconnectTimers.set(playerId, timer);
  }

  hasSeated(playerId: string): boolean {
    return this.seats.some((s) => s?.playerId === playerId);
  }

  command(playerId: string, cmd: TableCommand): Promise<void> {
    return this.enqueue(() => this.handleCommand(playerId, cmd));
  }

  protected async handleCommand(playerId: string, cmd: TableCommand): Promise<void> {
    switch (cmd.kind) {
      case 'sit':
        await this.sit(playerId, cmd.seat, cmd.buyIn, {
          ...(cmd.name ? { displayName: cmd.name } : {}),
          ...(cmd.avatarUrl ? { avatarUrl: cmd.avatarUrl } : {}),
        });
        break;
      case 'stand':
        await this.stand(playerId);
        break;
      case 'buyIn':
        await this.topUp(playerId, cmd.amount);
        break;
      case 'act':
        await this.handleAct(playerId, cmd.action);
        break;
    }
  }

  protected abstract handleAct(
    playerId: string,
    action: { type: string; amount?: number | undefined },
  ): Promise<void> | void;

  protected async sit(
    playerId: string,
    seatIndex: number,
    buyIn: number,
    profile: { displayName?: string; avatarUrl?: string },
  ): Promise<void> {
    if (this.seatOf(playerId)) throw new RoomError('already seated');
    if (seatIndex < 0 || seatIndex >= this.config.maxSeats) throw new RoomError('invalid seat index');
    if (this.seats[seatIndex]) throw new RoomError('seat taken');
    if (buyIn < this.config.minBuyIn || buyIn > this.config.maxBuyIn) {
      throw new RoomError(`buyIn must be between ${this.config.minBuyIn} and ${this.config.maxBuyIn}`);
    }

    const player = this.directory.ensure?.(playerId, profile) ?? this.directory.find(playerId);
    if (!player) throw new RoomError('unknown player');
    if (player.available < buyIn) throw new RoomError('insufficient funds');

    await this.fc.buyIn(playerId, String(buyIn));

    const isFirst = this.occupiedSeats().length === 0;
    this.seats[seatIndex] = this.createSeatRecord(seatIndex, playerId, player.displayName, buyIn, profile.avatarUrl, isFirst);

    this.push();
    this.onSeatChanged();
  }

  protected abstract createSeatRecord(
    seatIndex: number,
    playerId: string,
    displayName: string,
    buyIn: number,
    avatarUrl?: string,
    isFirst?: boolean,
  ): TSeat;

  /** A seat was taken or given up — deal if the game now has what it needs. */
  protected onSeatChanged(): void {}

  protected async stand(playerId: string): Promise<void> {
    const seat = this.seatOf(playerId);
    if (!seat) return;
    if (this.phase === 'IN_HAND' && seat.bet > 0) {
      throw new RoomError('cannot leave mid-hand with an active bet');
    }

    await this.releaseSeat(seat.index);
    this.push();
    this.onSeatChanged();
  }

  protected async topUp(playerId: string, amount: number): Promise<void> {
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('not seated');
    if (amount <= 0) throw new RoomError('invalid amount');

    const player = this.directory.find(playerId);
    if (!player || player.available < amount) throw new RoomError('insufficient funds');

    await this.fc.buyIn(playerId, String(amount));
    seat.stack += amount;
    this.push();
  }

  protected async releaseSeat(seatIndex: number): Promise<void> {
    const seat = this.seats[seatIndex];
    if (!seat) return;
    this.seats[seatIndex] = null;

    if (seat.stack > 0) {
      await this.fc.release(seat.playerId, String(seat.stack));
    }

    if (seat.isBanker) {
      const next = this.occupiedSeats()[0];
      if (next) next.isBanker = true;
    }
  }

  protected occupiedSeats(): TSeat[] {
    return this.seats.filter((s): s is TSeat => s !== null);
  }

  protected seatOf(playerId: string): TSeat | null {
    return this.seats.find((s) => s?.playerId === playerId) ?? null;
  }

  /**
   * Banker Exposure Guard:
   * Rejects any bet if aggregate exposure of ALL active bettors exceeds the banker's stack capacity.
   */
  protected checkBankerExposure(bankerSeat: TSeat, requestedBet: number, multiplier = 1, currentSeatIndex?: number): void {
    let activeExposure = 0;
    for (const s of this.occupiedSeats()) {
      if (!s.isBanker && s.bet > 0 && s.index !== currentSeatIndex) {
        const mult = (s as any).maxMultiplier ?? 1;
        activeExposure += s.bet * mult;
      }
    }
    const totalExposure = activeExposure + requestedBet * multiplier;
    if (bankerSeat.stack < totalExposure) {
      throw new RoomError(
        `aggregate bets (₮${totalExposure}) exceed banker stack capacity (₮${bankerSeat.stack})`,
      );
    }
  }

  /**
   * Evaluates jackpot injection and payouts for a round.
   * Converts chips to micro-USD and calls fc.jackpotPayout for any hit.
   */
  protected async processJackpot(
    winnerProfitChips: number,
    roundId: string,
    seed: string,
  ): Promise<void> {
    const candidates: JackpotCandidate[] = this.occupiedSeats().map((s) => ({
      playerId: s.playerId,
      baseWeight: 100,
      behavior: 'NORMAL',
      associated: false,
    }));

    const hits = this.roomJackpot.evaluateHand(
      winnerProfitChips * CHIPS_TO_MICROS,
      candidates,
      roundId,
      seed,
      (pId) => this.seatOf(pId)?.name ?? pId,
    );

    if (hits.length > 0) {
      const hit = hits[hits.length - 1]!;
      const hitChips = Math.floor(hit.amount / CHIPS_TO_MICROS);
      if (hitChips > 0) {
        const accounts = tableJackpotAccounts(this.config.id);
        const tierLower = hit.tier.toLowerCase() as 'mini' | 'minor' | 'major' | 'grand';
        const acctKey = accounts[tierLower];
        if (this.fc.jackpotPayout) {
          try {
            await this.fc.jackpotPayout({
              tableId: this.config.id,
              roundId,
              tier: tierLower,
              playerId: hit.playerId,
              amount: String(hitChips),
              jackpotAccountId: acctKey,
            });
            const winnerSeat = this.seatOf(hit.playerId);
            this.lastJackpotWin = {
              tier: hit.tier,
              playerId: hit.playerId,
              playerName: winnerSeat?.name ?? hit.playerId,
              amount: hitChips,
              animationMs: hit.animationMs,
              roundId: hit.roundId,
            };
          } catch (err) {
            console.error(`[room ${this.config.id}] Jackpot payout error:`, err);
          }
        }
      }
    }
  }

  abstract snapshotFor(playerId: string): TableSnapshot;

  summary(): TableSummary {
    return {
      tableId: this.config.id,
      name: this.config.name,
      variant: VARIANT_NAMES[this.config.game] ?? this.config.game,
      smallBlind: 0,
      bigBlind: 0,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      maxSeats: this.config.maxSeats,
      seated: this.occupiedSeats().length,
      phase: this.phase,
    };
  }

  protected push(): void {
    const delay = this.config.spectatorDelayMs ?? 0;
    for (const [pId, set] of this.viewers) {
      const snap = this.snapshotFor(pId);
      const isSpectator = !this.seatOf(pId);
      if (isSpectator && delay > 0) {
        setTimeout(() => {
          for (const client of set) client.sendSnapshot(snap);
        }, delay);
      } else {
        for (const client of set) client.sendSnapshot(snap);
      }
    }
  }

  dispose(): void {
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
  }
}
