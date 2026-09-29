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
   * On the way out — set by `stand()`, the disconnect-grace path and `drain()` right before each
   * calls `releaseSeat`, and left set if that release throws (BUG-07 follow-up, D6). A seat carrying
   * this must never be handed the bank, dealt in, or allowed a fresh bet: it is either genuinely
   * leaving or stuck on a release FC keeps refusing, and either way it has no business starting
   * something new. Cleared by `releaseSeat` succeeding (the seat is gone) — there is no other path
   * that clears it, on purpose: a seat that asked to leave does not change its mind by staying put.
   */
  leaving?: boolean;
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
  /** playerIds the grace timer found unsafe to release yet — retried by `releaseDeparted` at the
   *  next round boundary rather than waiting out the timer's own 5s re-arm (BUG-07 follow-up, D4). */
  protected readonly departing = new Set<string>();
  /** One retry sweep per room for every `leaving` seat a release has refused, independent of the
   *  per-player disconnect timers above — `stand()` can set `leaving` on a seat that is still
   *  connected, which has no disconnect timer of its own (BUG-07 follow-up, D6). */
  private readonly leavingRetryTimer: NodeJS.Timeout;
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

    this.leavingRetryTimer = setInterval(() => {
      void this.enqueue(() => this.retryLeavingSeats());
    }, 30_000);
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
      this.departing.delete(playerId);
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
   * Whether THIS seat, specifically, has anything live on it right now — not whether the table as a
   * whole is busy (BUG-07 follow-up, D4). The original grace check gated on `this.phase`, table-wide:
   * on a busy table a disconnected seat that never bet still saw `phase !== 'WAITING'` on every check,
   * because the next round always started before the grace task ran (a disconnected seat still counts
   * as occupied) — 42 hands, still seated, for a player who never had a chip at risk in any of them.
   *
   * Default: a live bet, or the banker's chair — the two ways a base-room seat carries risk. Dou Di
   * Zhu has no bet to check (no per-trick wager) so it overrides to phase-based; red-envelope's
   * equivalent of a bet is a claimed envelope; slots resolves a spin atomically and is never
   * "committed" between calls.
   */
  protected seatCommitted(seat: TSeat): boolean {
    return seat.bet > 0 || seat.isBanker === true;
  }

  /**
   * Whether the grace timer may actually let go of this disconnected seat's chair.
   *
   * Default: the table is fully idle (`WAITING` — nothing anywhere is at risk, so even a seat this
   * class considers "committed" by a sticky flag like `isBanker` is safe to let go of), OR this seat
   * specifically is not committed. Texas Cowboy overrides this: its open betting window IS phase
   * `WAITING` — seats place real bets into it — so `phase === 'WAITING'` cannot mean idle there the
   * way it does everywhere else, and only `seatCommitted` (which texas-cowboy leaves at the default,
   * bet-only) decides.
   */
  protected graceReleaseSafe(seat: TSeat): boolean {
    return this.phase === 'WAITING' || !this.seatCommitted(seat);
  }

  /**
   * The grace timer fires, checks whether it is actually safe to let go of the chair, and either
   * releases the seat or checks again shortly — it does not just give up (BUG-07).
   *
   * Marks the seat `leaving` (D6) the moment the timer confirms the player is genuinely gone (still
   * disconnected when the timer fires), whether or not release is safe yet: a seat on its way out
   * must stop being eligible for the bank or a fresh deal from this point, not only once the release
   * actually clears it.
   */
  protected armDisconnectGrace(playerId: string, graceMs = 30_000): void {
    if (this.disconnectTimers.has(playerId)) return;
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      void this.enqueue(async () => {
        const seat = this.seatOf(playerId);
        if (!seat || seat.connected) {
          this.departing.delete(playerId);
          return;
        }
        seat.leaving = true;
        if (!this.graceReleaseSafe(seat)) {
          // Not this seat's table-wide idle moment, and it is still carrying something — check back
          // shortly rather than dropping the grace entirely. Queued in `departing` too, so the next
          // round boundary's `releaseDeparted` can free it the instant it actually becomes safe,
          // rather than this seat waiting out its own next 5s tick.
          this.departing.add(playerId);
          this.armDisconnectGrace(playerId, 5_000);
          return;
        }
        try {
          await this.releaseSeat(seat.index);
        } catch (err) {
          // BUG-07 commit 1: a refused release now leaves the seat exactly as it was. `leaving` stays
          // set, so nothing hands this chair the bank or a fresh bet while it retries — every 30s via
          // the room's own leaving-seat sweep, and sooner via `releaseDeparted` at the next round
          // boundary, plus this timer's own backoff so a released-in-between success is not blocked
          // on the wider sweep alone.
          console.error(`[room ${this.config.id}] seat ${seat.index} failed to release after disconnect grace:`, err);
          this.departing.add(playerId);
          this.armDisconnectGrace(playerId, 30_000);
          return;
        }
        this.departing.delete(playerId);
        this.push();
      });
    }, graceMs);
    this.disconnectTimers.set(playerId, timer);
  }

  /**
   * Free every seat that grace queued as `departing` but could not yet release, plus any seat still
   * marked `leaving` from a `stand()` or `drain()` release that failed — called by every room right
   * after `this.phase = 'WAITING'` and BEFORE it deals the next round (BUG-07 follow-up, D4/D6). This
   * is the fix for the actual race the auditor found: a disconnected seat still counts as occupied,
   * so without this, `maybeStartRound()` claims it for the next hand before the grace timer's own
   * tick ever gets a chance to run.
   */
  protected async releaseDeparted(): Promise<void> {
    const indexes = new Set<number>();
    for (const playerId of this.departing) {
      const seat = this.seatOf(playerId);
      if (seat && !seat.connected) indexes.add(seat.index);
    }
    for (const seat of this.occupiedSeats()) {
      if (seat.leaving) indexes.add(seat.index);
    }
    for (const index of indexes) {
      const seat = this.seats[index];
      if (!seat) continue;
      const playerId = seat.playerId;
      try {
        await this.releaseSeat(index);
        this.departing.delete(playerId);
      } catch (err) {
        // Left in `departing` (if it was there) and still `leaving` — the next boundary, the 30s
        // sweep, or the seat's own grace timer tries again. Nothing paid or lost here either way.
        console.error(`[room ${this.config.id}] seat ${index} still could not be released:`, err);
      }
    }
  }

  /** The room's own 30s sweep for every `leaving` seat a release has refused — covers `stand()`
   *  failures too, which have no disconnect timer of their own to retry them (BUG-07 follow-up, D6). */
  protected async retryLeavingSeats(): Promise<void> {
    for (const seat of this.occupiedSeats()) {
      if (!seat.leaving) continue;
      try {
        await this.releaseSeat(seat.index);
      } catch (err) {
        console.error(`[room ${this.config.id}] seat ${seat.index} still leaving — retry failed:`, err);
      }
    }
    this.push();
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
      case 'act': {
        // Guarded HERE rather than in each of the ten subclasses' `handleAct` (D2, BUG-07 follow-up):
        // every one of them is reached only through this dispatch — confirmed none overrides
        // `command`/`handleCommand` — so one check covers every game's bet/act entry point.
        if (this.draining) throw new RoomError('this table is closing');
        // A leaving seat (D6, BUG-07 follow-up) is on its way out — refused a fresh bet the same way
        // `draining` refuses one, rather than letting more money ride on a chair about to be released.
        if (this.seatOf(playerId)?.leaving) throw new RoomError('you are leaving this table');
        await this.handleAct(playerId, cmd.action);
        break;
      }
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
    // BUG-07 follow-up, D6: the banker is the table's counterparty for every other seat's bet this
    // round — walking away mid-round leaves those bets with nothing backing them. WAITING is fine:
    // nothing is riding on the bank between rounds.
    if (this.phase !== 'WAITING' && seat.isBanker) {
      throw new RoomError("the banker can't leave mid-round");
    }

    // Set BEFORE the release, not after (D6): a refused release leaves the seat occupied, and it
    // must not be eligible for the bank, a fresh deal, or a fresh bet while it sits there waiting
    // for `retryLeavingSeats`/`releaseDeparted` to clear it. Nothing unsets this on failure —
    // `releaseSeat` succeeding is the only thing that ever removes the seat this flag is on.
    seat.leaving = true;
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
      // Skip a seat that is itself on the way out (D6, BUG-07 follow-up) — handing the bank to a
      // `leaving` seat just means reassigning it again the moment that seat's own release clears,
      // and in between it is a banker nobody can reach.
      const next = this.occupiedSeats().find((s) => !s.leaving) ?? this.occupiedSeats()[0];
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
   *
   * Releases every seat CONCURRENTLY (BUG-07 follow-up), not one at a time: a 6-seat table's
   * shutdown used to be bounded by the SUM of six FC timeouts, not one. `Promise.allSettled` keeps
   * each seat's own try/catch — one seat's failure still cannot strand another's release.
   */
  async drain(): Promise<void> {
    this.draining = true;
    let failures = 0;
    await this.enqueue(async () => {
      // Gated on IN_HAND (BUG-07 follow-up): a room can be draining during SHOWDOWN too, where every
      // bet has already been walked into `seat.stack` by the settlement that just ran — logging
      // "voids N unsettled bets" there would describe money that already settled, not money about
      // to be voided.
      const voided = this.phase === 'IN_HAND' ? this.occupiedSeats().filter((s) => s.bet > 0) : [];
      if (voided.length > 0) {
        console.error(
          `[room ${this.config.id}] drain voids ${voided.length} unsettled bet(s) — never left seat.stack`,
        );
      }
      const occupied = this.occupiedSeats();
      // Marked `leaving` before the release, same as `stand()` (D6, BUG-07 follow-up): a seat whose
      // release fails here must not be handed the bank or a fresh bet if the room somehow outlives
      // this drain, and it is what makes the 30s retry sweep and `releaseDeparted` keep trying it.
      for (const seat of occupied) seat.leaving = true;
      const results = await Promise.allSettled(occupied.map((seat) => this.releaseSeat(seat.index)));
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          failures += 1;
          console.error(
            `[room ${this.config.id}] seat ${occupied[i]!.index} failed to release during drain:`,
            result.reason,
          );
        }
      });
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
    this.departing.clear();
    clearInterval(this.leavingRetryTimer);
  }
}
