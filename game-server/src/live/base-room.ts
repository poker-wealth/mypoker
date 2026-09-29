import type { FinancialCoreClient, JackpotAccounts } from '../core/financial-core-client';
import { FakeChainClient, type ChainClient } from '../fairness';
import type { JackpotCandidate } from '../jackpot/weights';
import type { GameId } from '../lobby/game-catalog';
import type { LiveRoom, LiveTableConfig, RoomDeps } from './live-room';
import type { PlayerDirectory } from './players';
import type { BetAction, RoomPhase, TableCommand, TableSnapshot, TableSummary, JackpotWinSnapshot } from './room-state';

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
  /**
   * The worst this seat's standing bet can cost the bank, as a multiple of the stake — a tie at
   * baccarat's 8:1, a 5x stake against a 5x Niu Niu bank holding Five Small. Written by the room
   * when the bet is accepted and read back by `checkBankerExposure` when the NEXT bet is weighed,
   * which is the only way the guard can price a table's worth of bets instead of one at a time.
   */
  maxMultiplier?: number;
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
  /** Set synchronously by `drain()` (D2, BUG-07 follow-up) — refuses new money (`sit`/`topUp`) and
   *  new bets (`handleAct`) the instant shutdown starts, before the queue even sees it. */
  private draining = false;

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
          // Always armed (BUG-07) — it used to arm only when phase === 'WAITING' at the moment of
          // disconnect, and nothing re-armed it once a round that was running had ended. A player
          // who dropped mid-round kept their seat, and the money locked behind it, forever: the one
          // event that could have freed them (join()'s own reconnect path) never fires for someone
          // who never comes back.
          this.armDisconnectGrace(mine.playerId);
        }
      }
    };
  }

  /**
   * The grace timer fires, checks whether it is actually safe to let go of the chair, and either
   * releases the seat or checks again shortly — it does not just give up (BUG-07).
   *
   * "Safe" is phase !== 'WAITING' OR a live bet on this seat, not phase alone: a round in progress
   * covers most games (niu-niu's banker included — the banker never carries `bet`, but the room is
   * never WAITING while a hand is live), but texas-cowboy calls its open betting window 'WAITING'
   * while seats ARE placing real bets into it, so a bet on the seat has to gate the release too or
   * a disconnect during that window would return chips still at risk.
   */
  protected armDisconnectGrace(playerId: string, graceMs = 30_000): void {
    if (this.disconnectTimers.has(playerId)) return;
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      void this.enqueue(async () => {
        const seat = this.seatOf(playerId);
        if (!seat || seat.connected) return;
        if (this.phase !== 'WAITING' || seat.bet > 0) {
          // A round is live, or this seat is in it — check back shortly rather than dropping the
          // grace entirely; the player is released as soon as it is actually safe.
          this.armDisconnectGrace(playerId, 5_000);
          return;
        }
        try {
          await this.releaseSeat(seat.index);
        } catch (err) {
          // BUG-07 commit 1: a refused release now leaves the seat exactly as it was. Log and stop
          // — the seat stays occupied and connected=false, so the NEXT disconnect (a reconnect then
          // another drop) tries again rather than this timer spinning on a release FC keeps refusing.
          console.error(`[room ${this.config.id}] seat ${seat.index} failed to release after disconnect grace:`, err);
          return;
        }
        this.push();
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
        // Guarded HERE rather than in each of the ten subclasses' `handleAct` (D2, BUG-07 follow-up):
        // every one of them is reached only through this dispatch — confirmed none overrides
        // `command`/`handleCommand` — so one check covers every game's bet/act entry point.
        if (this.draining) throw new RoomError('this table is closing');
        await this.handleAct(playerId, cmd.action);
        break;
    }
  }

  /**
   * A move, already validated by `betActionSchema`. Rooms narrow it to the fields their own game
   * speaks — the parameter is bivariant, so a room that reads only `type` and `amount` still
   * satisfies this, while Niu Niu can declare `multiplier` and Dou Di Zhu `cards` without a cast.
   */
  protected abstract handleAct(playerId: string, action: BetAction): Promise<void> | void;

  protected async sit(
    playerId: string,
    seatIndex: number,
    buyIn: number,
    profile: { displayName?: string; avatarUrl?: string },
  ): Promise<void> {
    // Shutdown in progress (D2/D3, BUG-07 follow-up) — refuse fresh money the instant `drain()`
    // starts rather than lock a new buy-in into a table that is about to release every seat.
    if (this.draining) throw new RoomError('this table is closing');
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
    // Same shutdown guard as sit() — a top-up is new money too.
    if (this.draining) throw new RoomError('this table is closing');
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('not seated');
    if (amount <= 0) throw new RoomError('invalid amount');

    const player = this.directory.find(playerId);
    if (!player || player.available < amount) throw new RoomError('insufficient funds');

    await this.fc.buyIn(playerId, String(amount));
    seat.stack += amount;
    this.push();
  }

  /**
   * Give a seat's chips back and empty the chair.
   *
   * The chair is emptied AFTER the release, not before (BUG-07): this used to null the seat first
   * and call `fc.release` second, so a refused release — FC unreachable, a 409 — lost the seat AND
   * the money in the same moment. The chips stayed locked in FC with nothing at the table pointing
   * back at them, and nobody could retry: the chair looked empty and sittable. Mirrors the order
   * `PokerRoom.releaseSeat` already uses. A throw here now leaves the seat exactly as it was —
   * still occupied, still holding its stack — so the caller's own retry (a later `stand`, or the
   * next disconnect-grace check) is what actually clears it.
   */
  protected async releaseSeat(seatIndex: number): Promise<void> {
    const seat = this.seats[seatIndex];
    if (!seat) return;

    if (seat.stack > 0) {
      await this.fc.release(seat.playerId, String(seat.stack));
    }
    this.seats[seatIndex] = null;

    if (seat.isBanker) {
      const next = this.occupiedSeats()[0];
      if (next) next.isBanker = true;
    }
  }

  /**
   * A round that blew up must not take the table with it.
   *
   * `resolveRound` runs the settlement, and anything in there can throw — the ledger refusing, a
   * jackpot pool failing to open, a bug. When it did, nothing reset `phase`, so the room sat in
   * IN_HAND for good: players stood up, the seats emptied, and it still reported a hand in progress
   * with nobody to act. Only restarting the process cleared it. That is how a single settlement
   * error became four dead tables — see the jackpot-pool-owner fix in financial-core.
   *
   * Recovery is deliberately narrow. It puts the table back to WAITING so the next hand can start,
   * and it does NOT touch a stack or reverse anything: `fc.settleTableHand` is atomic, so a throw
   * from it means no money moved, and a throw AFTER it means money moved and the mirrored stacks
   * are already correct. Either way, inventing a correction here would be the actual disaster.
   */
  protected abandonRound(err: unknown): void {
    console.error(
      `[room ${this.config.id}] round failed to settle — table returned to WAITING, nothing paid or reversed:`,
      err,
    );
    // Surface it. A settlement failure is a money fault; left as a console line a RECURRING ledger
    // fault stays quiet. Report it so it lands in FC's append-only security_log and pages ops. Fire-
    // and-forget, exactly like the CB3 anomaly report — the recovery below must not wait on the alert.
    if (this.fc.reportSettlementFailure) {
      void this.fc
        .reportSettlementFailure({
          tableId: this.config.id,
          reason: err instanceof Error ? err.message : String(err),
        })
        .catch((e) => console.error(`[room ${this.config.id}] settlement-failure report to FC failed:`, e));
    }
    this.phase = 'WAITING';
    this.actionDeadline = null;
    this.push();
  }

  protected occupiedSeats(): TSeat[] {
    return this.seats.filter((s): s is TSeat => s !== null);
  }

  protected seatOf(playerId: string): TSeat | null {
    return this.seats.find((s) => s?.playerId === playerId) ?? null;
  }

  /**
   * Why the table is sitting still, in words a player can act on.
   *
   * Every game here refuses to deal below some number of seats, and until now each one just stayed
   * on WAITING and said nothing: you sat down at San Zhang alone, the felt offered a bet, and the
   * room answered "betting is closed" — a refusal that describes the state but not the reason.
   * Rooms put this in their snapshot so the felt can say who it is waiting for, and hide the
   * controls that cannot work yet.
   */
  protected waitingFor(minPlayers: number): string | undefined {
    if (this.phase !== 'WAITING') return undefined;
    const seated = this.occupiedSeats().length;
    const short = minPlayers - seated;
    if (short <= 0) return undefined;
    // "2 more players" reads as a lie to someone who has not sat down yet — there is nobody to be
    // more than. An empty table is waiting for players; a partly full one is waiting for the rest.
    if (seated === 0) return `Waiting for players — this table deals with ${minPlayers}.`;
    const players = short === 1 ? 'player' : 'players';
    return `Waiting for ${short} more ${players} — this table deals with ${minPlayers}.`;
  }

  /**
   * Banker Exposure Guard:
   * Rejects any bet if aggregate exposure of ALL active bettors exceeds the banker's stack capacity.
   */
  protected checkBankerExposure(bankerSeat: TSeat, requestedBet: number, multiplier = 1, currentSeatIndex?: number): void {
    let activeExposure = 0;
    for (const s of this.occupiedSeats()) {
      if (!s.isBanker && s.bet > 0 && s.index !== currentSeatIndex) {
        const mult = s.maxMultiplier ?? 1;
        activeExposure += s.bet * mult;
      }
    }
    const totalExposure = activeExposure + requestedBet * multiplier;
    if (bankerSeat.stack < totalExposure) {
      throw new RoomError(
        `aggregate bets ($${totalExposure}) exceed banker stack capacity ($${bankerSeat.stack})`,
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
            const result = await this.fc.jackpotPayout({
              tableId: this.config.id,
              roundId,
              tier: tierLower,
              playerId: hit.playerId,
              amount: String(hitChips),
              jackpotAccountId: acctKey,
              // Non-poker rooms have no league concept today — every base-room table is PLATFORM.
              // Explicit rather than left absent, so this stays true on purpose rather than by
              // accident of an unset optional field (BUG-16).
              tableType: 'PLATFORM',
            });
            if (result.applied) {
              const winnerSeat = this.seatOf(hit.playerId);
              this.lastJackpotWin = {
                tier: hit.tier,
                playerId: hit.playerId,
                playerName: winnerSeat?.name ?? hit.playerId,
                amount: hitChips,
                animationMs: hit.animationMs,
                roundId: hit.roundId,
              };
            } else {
              // FC's idempotency key is `${roundId}:jackpot:${tierLower}` — applied:false means this
              // exact payout already happened (a reused round id, most likely). No chips moved, so
              // announcing it again would tell a player they won money that never arrived.
              console.error(
                `[room ${this.config.id}] jackpot payout for ${roundId}:${tierLower} was a replay — not announced`,
              );
            }
          } catch (err) {
            console.error(`[room ${this.config.id}] Jackpot payout error:`, err);
          }
        }
      }
    }
  }

  abstract snapshotFor(playerId: string): TableSnapshot;

  /**
   * What this room charges per round, for the lobby's stakes column.
   *
   * The DEFAULT IS "nothing to report", because that is the truth for eight of
   * the nine games that inherit it: each player picks their own bet, so there
   * is no table-level stake at all. It used to default to `bigBlind: 0`, which
   * the lobby rendered as "Blinds 0/0" — a figure, and a false one.
   *
   * A hook rather than a cast on `this.config`: only some room configs have a
   * stake field, and a game that gains one should have to say so here rather
   * than have the base class rummage for it.
   */
  protected stakeLevel(): Pick<TableSummary, 'smallBlind' | 'bigBlind' | 'baseStake'> {
    return { smallBlind: null, bigBlind: null, baseStake: null };
  }

  summary(): TableSummary {
    return {
      tableId: this.config.id,
      name: this.config.name,
      variant: VARIANT_NAMES[this.config.game] ?? this.config.game,
      ...this.stakeLevel(),
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

  /**
   * Graceful shutdown (BUG-07 follow-up — D2): give every occupied seat's stack back through the
   * same path a voluntary `stand` uses, one seat at a time so one seat's FC failure doesn't strand
   * the rest — the same shape as `PokerRoom.finishClose`.
   *
   * Unlike a poker hand, a base-room round never has a live pot sitting apart from the seats: every
   * game here (baccarat, niu-niu, san-zhang, red-packet, red-envelope, cowboy-beauty, dou-di-zhu,
   * lottery, slots, texas-cowboy) only ever moves chips INTO `seat.stack` at settlement — a bet in
   * progress lives in `seat.bet`, which is display state the settlement loop reads, not money the
   * stack has already given up (verified per room for BUG-07: every `.stack +=`/`-=` site outside
   * `topUp` is inside that room's own settlement code). So `seat.stack` right now is always either
   * the untouched buy-in (a round mid-flight) or the fully-settled figure — never a value with money
   * missing from it — and releasing it here is safe to do at any phase, not just between rounds. A
   * seat still carrying a live `bet` is voided along with it: that bet never left `seat.stack`, so
   * releasing the seat's current stack already returns it in full.
   *
   * Queued (D2, BUG-07 follow-up): the first version released seats immediately, racing an in-flight
   * `handleAct` that is itself mid-settlement — `resolveRound`/`settleTableHand` reading or writing a
   * seat this loop had already emptied. `draining` flips synchronously, before the queue is even
   * touched, so `sit`/`topUp`/`act` are refused the instant shutdown starts; the release loop itself
   * runs as a queued task, so it only starts after whatever command or settlement was already in
   * flight has fully finished.
   */
  async drain(): Promise<void> {
    this.draining = true;
    let failures = 0;
    await this.enqueue(async () => {
      const voided = this.occupiedSeats().filter((s) => s.bet > 0);
      if (voided.length > 0) {
        console.error(
          `[room ${this.config.id}] drain voids ${voided.length} unsettled bet(s) — never left seat.stack`,
        );
      }
      for (const seat of this.occupiedSeats()) {
        try {
          await this.releaseSeat(seat.index);
        } catch (err) {
          failures += 1;
          console.error(`[room ${this.config.id}] seat ${seat.index} failed to release during drain:`, err);
        }
      }
      this.push();
    });
    if (failures > 0) {
      // TableHub.drain (D7) turns this rejection into a failure count the process can act on —
      // exit 1 instead of a silent 0 when chips were left stranded on shutdown.
      throw new Error(`[room ${this.config.id}] drain left ${failures} seat(s) unreleased`);
    }
  }

  dispose(): void {
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
  }
}
