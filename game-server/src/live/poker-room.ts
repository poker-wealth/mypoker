import { EventBus } from '../core/event-bus';
import type { FinancialCoreClient } from '../core/financial-core-client';
import { FakeChainClient } from '../fairness';
import type { ChainClient } from '../fairness';
import type { RoundNotary } from '../fairness/round-notary';
import { TexasGame } from '../games/texas/texas-game';
import { variant, type PokerVariant } from '../games/texas/variants';
import type { Action, SeatPublic, Street } from '../games/texas/betting';
import { isInsuranceEligible, underwrite } from '../games/texas/underwriting';
import { JackpotEngine, TIER_CONFIG } from '../jackpot/index';
import type { JackpotHit } from '../jackpot/index';
import type { TableSettlementRequest } from '../core/financial-core-client';
import type { ReserveState } from '../games/texas/underwriting';
import type { RakeConfig } from '../games/texas/settlement';

/**
 * Live insurance reserve, read from financial-core (§4).
 *
 * The reserve is cached briefly and refreshed in the background: quotes are
 * pre-computed as streets are dealt (spec: flop animation covers the compute),
 * so the health check may be a few seconds old but never invented. The three
 * figures the underwriter needs map to the pool like so:
 *
 *   reserveBalance    = INSURANCE account balance
 *   dailyBudget       = reserve × 15%   (§4 "Max Daily Payout", integer math)
 *   reservedExposure  = today's INSURANCE_PAYOUT total, from the ledger
 *
 * FAIL CLOSED: until a real read has succeeded, and once the last read is too
 * old to trust, there is no reserve — and no reserve means no offer, which is
 * exactly the spec's auto-disable rule ("reserve < threshold → insurance entry
 * hidden from player UI automatically"). An unreachable financial-core reads
 * as a pool that cannot prove its health, not as one assumed healthy.
 */
const RESERVE_REFRESH_MS = 15_000;
const RESERVE_TRUST_MS = 60_000;
const DAILY_BUDGET_PCT = 15; // §4 — of the reserve, per day

/** Whole-USD part of a decimal string, as integer chips (1 chip = $1). */
const chipsFromUsd = (decimal: string): number => {
  const whole = decimal.split('.')[0] ?? '0';
  const n = Number(whole);
  return Number.isSafeInteger(n) ? n : 0;
};
import type { HandResult } from '../games/texas/texas-hand';
import type { LiveRoom, LiveTableConfig } from './live-room';
import type { PlayerDirectory } from './players';
import type {
  FairnessSnapshot,
  RoomPhase,
  SeatSnapshot,
  TableCommand,
  TableSnapshot,
  InsuranceOffer,
  JackpotWinSnapshot,
  TableSummary,
} from './room-state';
import { newChatterState, evaluateChat, recordMessage, type ChatterState } from '../social/chat';
import { newTargetState, evaluateChallenge, recordPrompt, recordResult, type TargetState } from '../players/peer-challenge';

/**
 * PokerRoom — a real table that real people sit down at.
 *
 * This is the piece the demo never had. It owns the seats (who is in chair 4, what they're sitting
 * behind), decides when there are enough players to deal, runs each hand on the authoritative
 * `TexasGame`, gives whoever is to act a clock, and pushes every watcher a snapshot built for their
 * eyes only. Two phones, two accounts, one table.
 *
 * What the room does NOT do, on purpose:
 *   - it never deals or evaluates cards        → `TexasGame` / `TexasHand` (provably-fair deck)
 *   - it never writes a balance                → `FinancialCoreClient` (iron rule #3)
 *   - it never trusts a client's word for state → every command is re-derived from server state
 *
 * Everything is serialized through one promise queue, so a timeout firing while an action is
 * mid-flight can't interleave and corrupt the hand.
 */

export interface PokerRoomConfig extends LiveTableConfig {
  id: string;
  name: string;
  /** Which poker game this table hosts; also the `game` the hub dispatches on. */
  variantId: 'texas' | 'short-deck' | 'omaha';
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  /** How long a player has to act before the clock acts for them. */
  actionTimeoutMs: number;
  /** Breather between "enough players" and the cards coming out. */
  handStartDelayMs: number;
  /** How long the result stays on screen before the next hand. */
  showdownDelayMs: number;
  /** How long a disconnected player keeps their seat before being sat out. */
  disconnectGraceMs: number;
  /**
   * How far behind live a spectator sees the table (FairPlay §2.1). Server-enforced:
   * every snapshot and chat line to an unseated viewer is held back this long, so a
   * spectator relaying state to a seated friend is always relaying the past.
   */
  spectatorDelayMs: number;
  rake: RakeConfig;
}

export interface PokerRoomDeps {
  directory: PlayerDirectory;
  /** The ONLY route money takes. Play chips today, the Financial Core tomorrow. */
  fc: FinancialCoreClient;
  chain?: ChainClient;
  /** Notarizes each settled round (hash → Merkle batch → on-chain). Absent → hands still play,
   *  they just aren't published for verification (e.g. the standalone dev table server with no DB). */
  notary?: RoundNotary;
}

export interface RoomClient {
  sendSnapshot: (snapshot: TableSnapshot) => void;
  sendEvent: (event: string, data: unknown) => void;
}

export class RoomError extends Error {}

interface RoomSeat {
  index: number;
  playerId: string;
  name: string;
  avatarUrl?: string;
  /** Chips in front of them at this table. */
  stack: number;
  sittingOut: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  /** Asked to leave mid-hand — released as soon as the hand ends. */
  leaveAfterHand: boolean;
  /** Dealt into the hand in progress. */
  inHand: boolean;
  lastAction?: string;
  /** Fires when the disconnect grace expires (sit them out). */
  graceTimer?: NodeJS.Timeout;
  /** Fires when they've been gone long enough to give the chair back. */
  abandonTimer?: NodeJS.Timeout;
}

/** The shape `TexasGame.getPublicState()` returns (it's typed `unknown` at the base-game seam). */
interface EnginePublicState {
  phase: string;
  community: string[];
  pot: number;
  toAct: string | null;
  you: { hole: string[] | null; stack: number };
  seats: { id: string; stack: number }[];
}

const CATEGORY = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

/**
 * A disconnected player is sat out after the grace period and gets their chair back if they
 * return. This many grace periods later we assume they're gone for good, free the seat and return
 * their chips — nobody's money sits locked at a table they've abandoned.
 */
const ABANDON_MULTIPLIER = 5;

/** Spec (W8 social): "max 20 spectators per table". Seated players never count. */
const MAX_SPECTATORS = 20;

export const DEFAULT_ROOM: Omit<PokerRoomConfig, 'id' | 'name'> = {
  game: 'texas',
  variantId: 'texas',
  smallBlind: 10,
  bigBlind: 20,
  minBuyIn: 400, // 20 bb
  maxBuyIn: 4000, // 200 bb
  maxSeats: 6, // the house table art seats six
  actionTimeoutMs: 20_000,
  handStartDelayMs: 3_000,
  showdownDelayMs: 5_000,
  // §6.4: "Grace Period: 20-second reconnect window". Was 60s — a tripled
  // window is not a kindness, it is 40 extra seconds the rest of the table
  // waits per drop. The spec's timer-pause, 10s auto-check and the per-hand /
  // per-hour caps are P1 table-flow work and are tracked there.
  disconnectGraceMs: 20_000,
  spectatorDelayMs: 5_000,
  rake: { bps: 500, cap: 600, noFlopNoDrop: true },
};

export class PokerRoom implements LiveRoom {
  readonly config: PokerRoomConfig;
  private readonly directory: PlayerDirectory;
  private readonly fc: FinancialCoreClient;
  private readonly chainClient: ChainClient;
  private readonly notary: RoundNotary | undefined;
  private readonly spec: PokerVariant;

  private readonly seats: (RoomSeat | null)[];
  private readonly viewers = new Map<string, Set<RoomClient>>();
  private readonly chatters = new Map<string, ChatterState>();
  private readonly targets = new Map<string, TargetState>();

  // The last reserve read that succeeded, and when. Null until the first one
  // does — see the fail-closed note on the constants above.
  private reserve: ReserveState | null = null;
  private reserveFetchedAt = 0;
  private reserveRefreshing = false;

  private phase: RoomPhase = 'WAITING';
  private game: TexasGame | undefined;
  /** Device-generated client seeds players have supplied, applied to each hand's deal (§ provable fairness). */
  private readonly pendingClientSeeds = new Map<string, string>();
  private handNumber = 0;
  private buttonSeat = -1;
  private actionDeadline: number | null = null;
  private winners: number[] = [];
  /**
   * Trigger logic for this table's four pools (spec: pools are PER TABLE —
   * "owner_id = tableId, not gameType"). The engine's in-memory pools mirror
   * the ledger's from this boot onward; the LEDGER stays authoritative because
   * the payout goes through transfer(), whose overdraft guard makes a pool
   * unable to pay more than it truly holds however optimistic the mirror is.
   */
  private jackpotEngine: JackpotEngine | null = null;
  private lastJackpot: JackpotWinSnapshot | null = null;

  private jackpot(): JackpotEngine {
    // Lazy: `config` is a constructor parameter property, not available at
    // field-initialiser time.
    this.jackpotEngine ??= new JackpotEngine(this.config.id);
    return this.jackpotEngine;
  }
  private message: string | undefined;
  private readonly revealed = new Map<string, string[]>();

  private startTimer: NodeJS.Timeout | undefined;
  private actionTimer: NodeJS.Timeout | undefined;
  private showdownTimer: NodeJS.Timeout | undefined;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  /**
   * The game's view of money. The ROOM locks a player's buy-in once when they sit (and releases it
   * when they leave), so the per-hand game must not lock it again — it only settles.
   */
  private readonly handFc: FinancialCoreClient;

  constructor(config: PokerRoomConfig, deps: PokerRoomDeps) {
    // The hub dispatches on `game`; the engine deals from `variantId`. All three poker ids resolve
    // to this same class, so a mismatch is not a type error — it is an Omaha table quietly dealing
    // Hold'em. Refuse the table instead of opening it.
    if (config.game !== config.variantId) {
      throw new Error(
        `table ${config.id}: game "${config.game}" and variantId "${config.variantId}" must match`,
      );
    }
    this.config = config;
    this.directory = deps.directory;
    this.fc = deps.fc;
    this.chainClient = deps.chain ?? new FakeChainClient();
    this.notary = deps.notary;
    this.spec = variant(config.variantId);
    this.seats = Array.from({ length: config.maxSeats }, () => null);
    this.handFc = {
      buyIn: async (): Promise<void> => {},
      release: async (): Promise<void> => {},
      settleRound: (req): ReturnType<FinancialCoreClient['settleRound']> => this.fc.settleRound(req),
      settleTableHand: async (req): ReturnType<FinancialCoreClient['settleTableHand']> => {
        const result = await this.fc.settleTableHand(req);
        // Trigger evaluation rides the settlement: this is the one moment the
        // winner's profit is known and the money has actually moved.
        if (result.applied) await this.evaluateJackpots(req);
        return result;
      },
    };
  }

  // ── Watching ────────────────────────────────────────────────────────────────

  /**
   * Start receiving snapshots. Anyone authenticated may watch; sitting down is a separate command.
   * Returns the unsubscribe function — call it when the socket closes.
   */
  join(playerId: string, client: RoomClient): () => void {
    // Spec: max 20 spectators per table. A seated player (or one reconnecting
    // to their seat) is never refused — the cap is on watchers, because an
    // unbounded audience is a snapshot-fanout cost every action pays and, past
    // a point, a scraping surface. First-come, like a rail at a casino.
    //
    // Complements the 5-second spectator delay rather than duplicating it: the
    // delay decides WHAT a watcher sees, this decides HOW MANY there can be.
    const isSpectator = !this.seatOf(playerId);
    if (isSpectator && !this.viewers.has(playerId)) {
      const watching = [...this.viewers.keys()].filter((id) => !this.seatOf(id)).length;
      if (watching >= MAX_SPECTATORS) {
        throw new Error('table is full of spectators — try another table');
      }
    }

    let senders = this.viewers.get(playerId);
    if (!senders) {
      senders = new Set();
      this.viewers.set(playerId, senders);
    }
    senders.add(client);

    const seat = this.seatOf(playerId);
    if (seat) {
      seat.connected = true;
      seat.disconnectedAt = null;
      this.clearAwayTimers(seat); // they're back — cancel the sit-out and the eviction
    }
    client.sendSnapshot(this.snapshotFor(playerId));
    if (seat) this.push();

    return (): void => {
      const set = this.viewers.get(playerId);
      set?.delete(client);
      if (set && set.size === 0) {
        this.viewers.delete(playerId);
        const mine = this.seatOf(playerId);
        if (mine) {
          mine.connected = false;
          mine.disconnectedAt = Date.now();
          this.startAwayTimers(mine);
          this.push();
        }
      }
    };
  }

  /**
   * Losing your connection shouldn't cost you your seat — or leave your chips stranded. First the
   * grace period sits you out; long after that, the chair is freed and the chips go home.
   */
  private startAwayTimers(seat: RoomSeat): void {
    this.clearAwayTimers(seat);
    const playerId = seat.playerId;
    seat.graceTimer = setTimeout(() => {
      void this.enqueue(() => {
        const mine = this.seatOf(playerId);
        if (!mine || mine.connected) return;
        mine.sittingOut = true;
        this.push();
      });
    }, this.config.disconnectGraceMs);

    seat.abandonTimer = setTimeout(() => {
      void this.enqueue(() => this.dropIfAbandoned(playerId));
    }, this.config.disconnectGraceMs * ABANDON_MULTIPLIER);
  }

  private clearAwayTimers(seat: RoomSeat): void {
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    if (seat.abandonTimer) clearTimeout(seat.abandonTimer);
    delete seat.graceTimer;
    delete seat.abandonTimer;
  }

  private async dropIfAbandoned(playerId: string): Promise<void> {
    const seat = this.seatOf(playerId);
    if (!seat || seat.connected) return;
    if (seat.inHand && this.phase === 'IN_HAND') {
      // Mid-hand: they finish it (the clock folds for them), then the seat is released.
      seat.leaveAfterHand = true;
      seat.sittingOut = true;
      return;
    }
    await this.releaseSeat(seat.index);
    this.push();
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  /** Whether this player currently holds a seat here. Watching does not count. */
  hasSeated(playerId: string): boolean {
    return this.occupied().some((seat) => seat.playerId === playerId);
  }

  /** Apply a client command. Rejects (with a readable message) if it isn't legal right now. */
  command(playerId: string, cmd: TableCommand): Promise<void> {
    return this.enqueue(() => this.handle(playerId, cmd));
  }

  private async handle(playerId: string, cmd: TableCommand): Promise<void> {
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
      case 'sitOut':
        this.setSittingOut(playerId, true);
        break;
      case 'sitIn':
        this.setSittingOut(playerId, false);
        break;
      case 'act':
        await this.playerAct(playerId, cmd.action as Action);
        break;
      case 'chat':
        this.chat(playerId, cmd.message);
        break;
      case 'challenge':
        this.challenge(playerId, cmd.targetId);
        break;
      case 'answer_challenge':
        this.answerChallenge(playerId, cmd.passed, cmd.responseMs);
        break;
      case 'set_client_seed':
        this.setClientSeed(playerId, cmd.seed);
        break;
      default:
        throw new RoomError('unknown command');
    }
  }

  /** A seated player supplies their device-generated client seed; it feeds every subsequent deal. */
  private setClientSeed(playerId: string, seed: string): void {
    if (!this.hasSeated(playerId)) throw new RoomError('take a seat before setting a client seed');
    this.pendingClientSeeds.set(playerId, seed.toLowerCase());
  }

  private async sit(
    playerId: string,
    seatIndex: number,
    buyIn: number,
    profile: { displayName?: string; avatarUrl?: string },
  ): Promise<void> {
    if (this.seatOf(playerId)) throw new RoomError('you are already seated');
    if (seatIndex < 0 || seatIndex >= this.config.maxSeats) throw new RoomError('no such seat');
    if (this.seats[seatIndex]) throw new RoomError('seat taken');
    if (buyIn < this.config.minBuyIn || buyIn > this.config.maxBuyIn) {
      throw new RoomError(`buy-in must be between ${this.config.minBuyIn} and ${this.config.maxBuyIn}`);
    }
    // First time we've seen this player id, the directory gets to create their record.
    const player = this.directory.ensure?.(playerId, profile) ?? this.directory.find(playerId);
    if (!player) throw new RoomError('unknown player');
    if (player.available < buyIn) throw new RoomError('not enough chips');

    // Money first: if the lock fails, no seat is created.
    await this.fc.buyIn(playerId, String(buyIn));
    this.seats[seatIndex] = {
      index: seatIndex,
      playerId,
      name: player.displayName,
      ...(player.avatarUrl ? { avatarUrl: player.avatarUrl } : {}),
      stack: buyIn,
      sittingOut: false,
      connected: this.viewers.has(playerId),
      disconnectedAt: null,
      leaveAfterHand: false,
      inHand: false,
    };
    this.push();
    this.maybeStartHand();
  }

  private async stand(playerId: string): Promise<void> {
    const seat = this.requireSeat(playerId);
    if (seat.inHand && this.phase === 'IN_HAND') {
      // You can't take chips off the table mid-hand: fold if it's on you, leave when the hand ends.
      seat.leaveAfterHand = true;
      seat.sittingOut = true;
      if (this.toActPlayer() === playerId) await this.applyAction(playerId, { type: 'fold' }, 'Fold');
      else this.push();
      return;
    }
    await this.releaseSeat(seat.index);
    this.push();
  }

  private async topUp(playerId: string, amount: number): Promise<void> {
    const seat = this.requireSeat(playerId);
    if (seat.inHand && this.phase === 'IN_HAND') throw new RoomError('you can top up between hands');
    if (seat.stack + amount > this.config.maxBuyIn) {
      throw new RoomError(`a stack may not exceed ${this.config.maxBuyIn}`);
    }
    const player = this.directory.find(playerId);
    if (!player || player.available < amount) throw new RoomError('not enough chips');

    await this.fc.buyIn(playerId, String(amount));
    seat.stack += amount;
    if (seat.stack > 0) seat.sittingOut = false;
    this.push();
    this.maybeStartHand();
  }

  private setSittingOut(playerId: string, value: boolean): void {
    const seat = this.requireSeat(playerId);
    if (!value && seat.stack <= 0) throw new RoomError('buy chips before sitting back in');
    seat.sittingOut = value;
    this.push();
    if (!value) this.maybeStartHand();
  }

  private chat(playerId: string, message: string): void {
    let state = this.chatters.get(playerId);
    if (!state) {
      state = newChatterState();
      this.chatters.set(playerId, state);
    }
    const player = this.directory.find(playerId);
    if (!player) return;

    // A spectator is anyone not seated.
    const isSpectator = !this.seatOf(playerId);
    
    const decision = evaluateChat(state, {
      reputationScore: player.reputationScore,
      isSpectator,
      message,
      now: Date.now(),
    });

    if (!decision.ok) {
      throw new RoomError(`Chat denied: ${decision.reason}`);
    }

    recordMessage(state, Date.now());

    const eventData = {
      id: crypto.randomUUID(),
      senderId: playerId,
      senderName: player.displayName,
      text: message.trim(),
      timestamp: Date.now(),
    };

    for (const [viewerId, clients] of this.viewers.entries()) {
      const isSpectator = !this.seatOf(viewerId);
      const sendEvent = () => {
        for (const client of clients) {
          client.sendEvent('chat_message', eventData);
        }
      };

      if (isSpectator && this.config.spectatorDelayMs > 0) {
        setTimeout(sendEvent, this.config.spectatorDelayMs);
      } else {
        sendEvent();
      }
    }
  }

  private challenge(challengerId: string, targetId: string): void {
    if (challengerId === targetId) throw new RoomError('you cannot challenge yourself');
    const targetSeat = this.seatOf(targetId);
    if (!targetSeat) throw new RoomError('target is not at this table');

    let state = this.targets.get(targetId);
    if (!state) {
      state = newTargetState();
      this.targets.set(targetId, state);
    }

    const decision = evaluateChallenge(state, challengerId, Date.now());
    if (decision.outcome === 'REJECTED') {
      throw new RoomError(`Challenge denied: ${decision.reason}`);
    }
    
    if (decision.outcome === 'AUTO_PASS') {
      // The challenge is silently accepted and ignored
      return;
    }

    recordPrompt(state, challengerId, Date.now());

    // Send a prompt event to the target only
    const targetClients = this.viewers.get(targetId);
    if (targetClients) {
      for (const client of targetClients) {
        client.sendEvent('prompt_challenge', { challengerId, targetId });
      }
    }
  }

  private answerChallenge(targetId: string, passed: boolean, responseMs: number): void {
    const state = this.targets.get(targetId);
    if (!state) return; // No pending challenge state

    // In a real implementation, we'd know who the challenger was for this prompt.
    // For now, we pass a dummy 'unknown' or the latest challenger.
    // Actually `recordResult` requires `challengerId` for blowback.
    // We can just use the latest one from `challengedToday`, but finding it is tricky.
    // We'll skip blowback by passing a blank ID for now, or finding the most recent one.
    let recentChallengerId = '';
    let maxTime = -1;
    for (const [cid, timeKey] of state.challengedToday.entries()) {
      if (timeKey > maxTime) {
        maxTime = timeKey;
        recentChallengerId = cid;
      }
    }

    const consequence = recordResult(state, recentChallengerId, { passed, responseMs }, Date.now());
    
    if (consequence.reputationDelta < 0) {
       // Target failed: deduct reputation and stand them up next round
       const player = this.directory.find(targetId);
       if (player) {
         player.reputationScore += consequence.reputationDelta;
       }
       const seat = this.seatOf(targetId);
       if (seat) seat.leaveAfterHand = true; // restriction
    }
  }

  private async playerAct(playerId: string, action: Action): Promise<void> {
    if (this.phase !== 'IN_HAND' || !this.game) throw new RoomError('no hand in progress');
    this.requireSeat(playerId);
    if (this.toActPlayer() !== playerId) throw new RoomError('not your turn');
    await this.applyAction(playerId, action, this.describeAction(action));
    // The action passed to the bots — play their turns before handing the table back.
  }

  // ── The hand loop ───────────────────────────────────────────────────────────

  /** Deal as soon as two players with chips are ready — the table runs itself. */
  private maybeStartHand(): void {
    if (this.disposed || this.phase !== 'WAITING' || this.startTimer) return;
    if (this.readySeats().length < 2) return;

    this.phase = 'DEALING';
    this.push();
    this.startTimer = setTimeout(() => {
      this.startTimer = undefined;
      void this.enqueue(() => this.startHand());
    }, this.config.handStartDelayMs);
  }

  private async startHand(): Promise<void> {
    if (this.disposed) return;
    const players = this.readySeats();
    if (players.length < 2) {
      this.phase = 'WAITING';
      this.push();
      return;
    }

    this.handNumber += 1;
    this.buttonSeat = this.nextButton(players);
    const buttonIndex = Math.max(0, players.findIndex((s) => s.index === this.buttonSeat));

    const game = new TexasGame(
      `${this.config.id}-${this.handNumber}`,
      this.handFc,
      new EventBus(),
      {
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
        tableType: 'PLATFORM',
        accountOf: (playerId): string => playerId,
        // Per-table ids, per spec. The previous shared 'jp:mini' strings were
        // never created as accounts at all — transfer() throws on a missing
        // account — so injections could not have been landing.
        jackpotAccounts: this.jackpotAccountIds(),
        rake: this.config.rake,
        ...(this.config.variantId !== 'texas' ? { variant: this.spec } : {}),
      },
      this.chainClient,
    );
    for (const seat of players) await game.seatPlayer(seat.playerId, seat.stack);
    // Feed each player's own client seed into this deal before it commits (provable fairness). A seat
    // that never supplied one falls back to a server seed inside the engine.
    for (const seat of players) {
      const seed = this.pendingClientSeeds.get(seat.playerId);
      if (seed) game.setClientSeed(seat.playerId, seed);
    }
    await game.startHand(buttonIndex);

    this.game = game;
    this.winners = [];
    this.lastJackpot = null; // the previous hand's celebration ends here
    this.message = undefined;
    this.revealed.clear();
    for (const seat of this.occupied()) {
      seat.inHand = players.includes(seat);
      delete seat.lastAction;
    }
    this.phase = 'IN_HAND';
    this.armActionClock();
    this.push();
  }

  private async applyAction(playerId: string, action: Action, label?: string): Promise<void> {
    const seat = this.seatOf(playerId);
    this.clearActionClock();
    await this.game!.handleAction(playerId, action);
    if (seat && label) seat.lastAction = label;

    if (this.game!.state === 'WAITING') await this.finishHand();
    else {
      this.armActionClock();
      this.push();
    }
  }

  private armActionClock(): void {
    this.clearActionClock();
    const toAct = this.toActPlayer();
    if (!toAct) return;
    this.actionDeadline = Date.now() + this.config.actionTimeoutMs;
    this.actionTimer = setTimeout(() => {
      this.actionTimer = undefined;
      void this.enqueue(() => this.actForTimedOutPlayer(toAct));
    }, this.config.actionTimeoutMs);
  }

  private clearActionClock(): void {
    if (this.actionTimer) clearTimeout(this.actionTimer);
    this.actionTimer = undefined;
    this.actionDeadline = null;
  }

  /** The clock ran out: check if it's free, otherwise fold. A missing player is also sat out. */
  private async actForTimedOutPlayer(playerId: string): Promise<void> {
    if (this.phase !== 'IN_HAND' || !this.game || this.toActPlayer() !== playerId) return;
    const legal = this.game.legalActions();
    const check = legal?.canCheck ?? false;
    const seat = this.seatOf(playerId);
    if (seat && !seat.connected) seat.sittingOut = true;
    await this.applyAction(playerId, check ? { type: 'check' } : { type: 'fold' }, check ? 'Check' : 'Fold');
  }

  private async finishHand(): Promise<void> {
    this.clearActionClock();
    const game = this.game!;

    // The engine's stacks are authoritative — they already have rake and jackpot taken out.
    const stacks = game.seatedStacks();
    for (const seat of this.occupied()) {
      const stack = stacks.get(seat.playerId);
      if (stack !== undefined) seat.stack = stack;
    }

    const result = game.settledResult();
    this.winners = [];
    if (result) {
      for (const [playerId, won] of result.payouts) {
        const seat = this.seatOf(playerId);
        if (seat && won > 0) this.winners.push(seat.index);
      }
      for (const entry of result.showdown) this.revealed.set(entry.id, [...entry.hole]);
      this.message = this.describeResult(result);
    }

    // Publish the round for verification — hash it, persist it, queue it on-chain. Fire-and-forget,
    // off the hand's path (a chain/DB hiccup must never delay the showdown).
    this.notarizeRound(game);

    this.phase = 'SHOWDOWN';
    this.push();
    this.showdownTimer = setTimeout(() => {
      this.showdownTimer = undefined;
      void this.enqueue(() => this.endShowdown());
    }, this.config.showdownDelayMs);
  }

  private async endShowdown(): Promise<void> {
    if (this.disposed) return;

    for (const seat of this.occupied()) {
      seat.inHand = false;
      delete seat.lastAction;
      // Busted: keep the chair, stop dealing them in until they rebuy.
      if (seat.stack <= 0) seat.sittingOut = true;
    }
    for (const seat of this.occupied()) {
      if (seat.leaveAfterHand) await this.releaseSeat(seat.index);
    }

    this.winners = [];
    this.message = undefined;
    this.revealed.clear();
    this.phase = 'WAITING';
    this.push();
    this.maybeStartHand();
  }

  /**
   * Publish a settled round for provable-fairness verification — off the critical path, never throws
   * into the hand. The `cards` bound into the round hash are the FULL deck derived from finalSeed,
   * which is exactly what the verifier re-derives and checks (step 4/5).
   */
  private notarizeRound(game: TexasGame): void {
    const notary = this.notary;
    if (!notary) return;
    const round = game.roundInfo();
    if (!round) return;
    const cards = this.spec.deckFor(round.finalSeed);
    void notary
      .notarize({
        roundId: round.roundId,
        serverCommit: round.serverCommit,
        serverSeed: round.serverSeed,
        allClientSeeds: round.allClientSeeds,
        seatedClientSeeds: round.seats,
        futureBlockHash: round.futureBlockHash,
        finalSeed: round.finalSeed,
        cards,
        timestamp: Date.now(),
      })
      .catch((err) => console.error('[notary] round not notarized:', (err as Error).message));
  }

  /** Give a seat's chips back and empty the chair. */
  private async releaseSeat(index: number): Promise<void> {
    const seat = this.seats[index];
    if (!seat) return;
    this.clearAwayTimers(seat);
    if (seat.stack > 0) await this.fc.release(seat.playerId, String(seat.stack));
    this.seats[index] = null;
  }

  // ── Snapshots ───────────────────────────────────────────────────────────────

  /** The four pool account ids for this table, by tier. */
  private jackpotAccountIds(): { mini: string; minor: string; major: string; grand: string } {
    const id = this.config.id;
    return { mini: `jp:${id}:mini`, minor: `jp:${id}:minor`, major: `jp:${id}:major`, grand: `jp:${id}:grand` };
  }

  /**
   * Mirror the injection, ask the engine for hits, and PAY them through the
   * ledger before announcing anything.
   *
   * Order matters: the payout transfer is the money truth. Only a hit the
   * ledger accepted reaches the snapshot — an animation for a win that did not
   * credit is the exact failure this feature was held back to avoid. A payout
   * the ledger refuses (overdrawn mirror, pool drift) is logged and the hit is
   * NOT shown; the player has lost nothing they ever had.
   *
   * Candidates default to CLEAN behaviour until the anti-bot pipeline feeds the
   * live room — the weights module is wired, its inputs are not yet.
   */
  private async evaluateJackpots(req: TableSettlementRequest): Promise<void> {
    // No payer, no party. The optional method exists so demo fakes need not
    // implement money — but a hit that cannot be PAID must never be announced,
    // and optional chaining alone would have skipped the payment and then
    // celebrated anyway. (Found in review: the live server's ChipBank lacked
    // the method entirely. It has one now; this guard covers any future fake.)
    if (!this.fc.jackpotPayout) return;

    // ── UNITS ── The table speaks chips (1 chip = 1 currency unit in every
    // settlement decimal string); the JackpotEngine speaks micro-USD — its
    // thresholds are usd(10)…usd(1000). The first wiring injected raw chips,
    // so a pool could NEVER reach a 10,000,000-micro threshold and no jackpot
    // would ever have fired. Convert at this boundary, both directions.
    const CHIPS_TO_MICROS = 1_000_000;
    const winnerProfit = req.winners.reduce((sum, w) => sum + Number(w.amount), 0);
    if (winnerProfit > 0) this.jackpot().inject(Math.round(winnerProfit * CHIPS_TO_MICROS));

    const seatIds = [...req.winners, ...req.losers].map((p) => p.playerAccountId);
    const engine = this.jackpot();
    const now = Date.now();
    const wasFrozen = engine.isFrozen();
    const hits = engine.onRoundSettled({
      roundId: req.roundId,
      seed: this.game?.roundInfo()?.finalSeed ?? req.roundId,
      now,
      candidates: seatIds.map((playerId) => ({
        playerId,
        baseWeight: 1,
        behavior: 'NORMAL' as const,
        associated: false,
      })),
    });

    // CB3 edge — the engine froze THIS round (three jackpots inside an hour on this table, a farming
    // signature). It has already stopped paying locally; report it to FC so the freeze lands in the
    // append-only security_log and pages ops. Fire-and-forget: a reporting hiccup must never disturb
    // settlement, and the local freeze already holds regardless of whether the alert gets through.
    if (!wasFrozen && engine.isFrozen() && this.fc.reportJackpotAnomaly) {
      void this.fc
        .reportJackpotAnomaly({ tableId: this.config.id, triggersLastHour: engine.triggersLastHour(now) })
        .catch((err) => console.error('[room] CB3 anomaly report to FC failed:', err));
    }

    const pools = this.jackpotAccountIds();
    for (const hit of hits) {
      const tierKey = hit.tier.toLowerCase() as 'mini' | 'minor' | 'major' | 'grand';
      const amountChips = hit.amount / CHIPS_TO_MICROS; // micros → table currency
      try {
        await this.fc.jackpotPayout({
          tableId: this.config.id,
          tier: tierKey,
          jackpotAccountId: pools[tierKey],
          playerId: hit.playerId,
          amount: amountChips.toFixed(6),
          roundId: req.roundId,
        });
      } catch (err) {
        console.error('[room] jackpot payout refused by ledger — hit not shown:', err);
        continue;
      }
      this.announceJackpot(hit, amountChips);
    }
  }

  private announceJackpot(hit: JackpotHit, amountChips: number): void {
    const seat = this.occupied().find((s) => s.playerId === hit.playerId);
    this.lastJackpot = {
      tier: hit.tier,
      playerId: hit.playerId,
      playerName: seat?.name ?? hit.playerId,
      amount: amountChips,
      animationMs: TIER_CONFIG[hit.tier].animationMs,
      roundId: hit.roundId,
    };
    this.push();
  }

  /**
   * Kick a background refresh of the reserve when the cache is due. Fire and
   * forget: quoting reads whatever the last successful fetch produced, and a
   * failed fetch simply lets the cached state age out to "no offer".
   */
  private refreshReserve(): void {
    if (!this.fc.insuranceReserve) return;
    if (this.reserveRefreshing || Date.now() - this.reserveFetchedAt < RESERVE_REFRESH_MS) return;

    this.reserveRefreshing = true;
    // Platform system: live rooms are platform tables. A league room passes its
    // leagueId here, which reaches the league's own pool and nobody else's.
    this.fc
      .insuranceReserve('PLATFORM')
      .then((facts) => {
        const reserveBalance = chipsFromUsd(facts.insuranceBalance);
        this.reserve = {
          reserveBalance,
          dailyBudget: Math.floor((reserveBalance * DAILY_BUDGET_PCT) / 100),
          reservedExposure: chipsFromUsd(facts.todayPaidOut),
        };
        this.reserveFetchedAt = Date.now();
      })
      .catch((err) => {
        console.error('[room] insurance reserve unreadable — offers will close:', err);
      })
      .finally(() => {
        this.reserveRefreshing = false;
      });
  }

  /** The reserve to quote against right now, or null when there is none to trust. */
  private currentReserve(): ReserveState | null {
    if (!this.reserve) return null;
    if (Date.now() - this.reserveFetchedAt > RESERVE_TRUST_MS) return null;
    return this.reserve;
  }

  /**
   * The insurance offer for one viewer, or null.
   *
   * Eligibility is the engine's rule (exactly two all-in, board of 3 or 4), and
   * it is asked rather than re-derived here — a second definition of "when
   * insurance applies" would drift from the one the underwriter uses.
   *
   * Returns null for everyone except the two all-in players. A spectator or a
   * folded seat seeing an offer would leak that two people are all-in before the
   * table shows it.
   *
   * Quotes are arithmetic on the LIVE pool (`currentReserve`), never a fixed
   * figure. Every way that read can fail — no reserve yet, a stale one, an
   * unreadable financial-core, a pool of zero — ends at no offer rather than at
   * a guess, which is also how §4's auto-disable rule is enforced: a reserve
   * under threshold cannot produce a quote.
   */
  private insuranceFor(playerId: string, engine: EnginePublicState | null): InsuranceOffer | null {
    if (!engine || this.phase !== 'IN_HAND') return null;

    // Refresh on every ask, so a hand that reaches an all-in has a recent
    // health check waiting; the fetch itself never blocks a snapshot.
    this.refreshReserve();
    const reserve = this.currentReserve();
    if (!reserve) return null;

    const handSeats = this.game ? this.game.handSeats() : [];
    const allIn = handSeats.filter((s) => s.status === 'allin');
    if (!isInsuranceEligible(allIn.length, engine.community)) return null;

    // Only the players actually at risk are offered anything.
    const mine = allIn.find((s) => s.id === playerId);
    const other = allIn.find((s) => s.id !== playerId);
    if (!mine || !other) return null;

    // Both hands, read server-side. getPublicState returns only the requested
    // player's own cards, which is the rule that keeps clients honest — asking
    // it twice here is the room using its own engine, not a client seeing
    // another player's hand. Neither set of cards reaches the snapshot: only the
    // resulting odds do.
    const myCards = (this.game?.getPublicState(playerId) as EnginePublicState | undefined)?.you.hole;
    const theirCards = (this.game?.getPublicState(other.id) as EnginePublicState | undefined)?.you
      .hole;
    if (!myCards || !theirCards || myCards.length < 2 || theirCards.length < 2) return null;

    const result = underwrite(
      {
        insured: [myCards[0]!, myCards[1]!],
        opponent: [theirCards[0]!, theirCards[1]!],
        board: [...engine.community],
        pot: engine.pot,
        requestedCoverage: mine.streetContributed,
      },
      reserve,
    );
    if (!result.offered) return null;

    return { ...result.quote, expiresInSeconds: 10 };
  }

  /** The table as `playerId` is allowed to see it. Their hole cards; nobody else's. */
  snapshotFor(playerId: string): TableSnapshot {
    const live = this.phase === 'IN_HAND' || this.phase === 'SHOWDOWN';
    const engine = live && this.game ? (this.game.getPublicState(playerId) as EnginePublicState) : null;
    const handSeats = new Map<string, SeatPublic>(
      (live && this.game ? this.game.handSeats() : []).map((s) => [s.id, s]),
    );
    const showdown = this.phase === 'SHOWDOWN';

    const streetBets = showdown
      ? 0
      : [...handSeats.values()].reduce((sum, s) => sum + s.streetContributed, 0);
    const pot = engine ? engine.pot - streetBets : 0;

    const seats: SeatSnapshot[] = this.occupied().map((seat) => {
      const inHand = seat.inHand && handSeats.has(seat.playerId);
      const detail = handSeats.get(seat.playerId);
      return {
        index: seat.index,
        playerId: seat.playerId,
        name: seat.name,
        ...(seat.avatarUrl ? { avatarUrl: seat.avatarUrl } : {}),
        stack: seat.stack,
        bet: showdown || !detail ? 0 : detail.streetContributed,
        status: this.seatStatus(seat, detail),
        inHand,
        connected: seat.connected,
        isDealer: seat.index === this.buttonSeat && live,
        isWinner: this.winners.includes(seat.index),
        isYou: seat.playerId === playerId,
        cards: this.cardsFor(seat, playerId, engine, detail),
        ...(seat.lastAction ? { lastAction: seat.lastAction } : {}),
      };
    });

    const mySeat = this.seatOf(playerId);
    const toAct = this.toActPlayer();
    const me = this.directory.find(playerId);
    const fairness = this.fairnessFor(live);

    return {
      tableId: this.config.id,
      name: this.config.name,
      variant: this.spec.name,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      maxSeats: this.config.maxSeats,

      phase: this.phase,
      handId: live ? (this.game?.roundInfo()?.roundId ?? null) : null,
      handNumber: this.handNumber,
      street: live ? this.streetOf() : null,
      pot: Math.max(0, pot),
      board: engine ? engine.community : [],
      seats,
      insurance: this.insuranceFor(playerId, engine),
      jackpot: this.lastJackpot,

      yourSeat: mySeat ? mySeat.index : null,
      you: me ? { playerId: me.id, name: me.displayName, available: me.available } : null,
      toActSeat: toAct ? (this.seatOf(toAct)?.index ?? null) : null,
      actionDeadline: this.actionDeadline,
      // Legal actions are computed for the seat to act and sent ONLY to them.
      legal: toAct === playerId && this.game ? this.game.legalActions() : null,
      winners: [...this.winners],
      ...(this.message ? { message: this.message } : {}),
      ...(fairness ? { fairness } : {}),
      serverTime: Date.now(),
    };
  }

  summary(): TableSummary {
    return {
      tableId: this.config.id,
      name: this.config.name,
      variant: this.spec.name,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      maxSeats: this.config.maxSeats,
      seated: this.occupied().length,
      phase: this.phase,
    };
  }

  /** Push a fresh, per-viewer snapshot to everyone watching. */
  private push(): void {
    for (const [viewerId, clients] of this.viewers.entries()) {
      const snap = this.snapshotFor(viewerId);
      const isSpectator = !this.seatOf(viewerId);

      const sendSnapshot = () => {
        for (const client of clients) client.sendSnapshot(snap);
      };

      if (isSpectator && this.config.spectatorDelayMs > 0) {
        setTimeout(sendSnapshot, this.config.spectatorDelayMs);
      } else {
        sendSnapshot();
      }
    }
  }

  private seatStatus(seat: RoomSeat, detail: SeatPublic | undefined): SeatSnapshot['status'] {
    if (detail) return detail.status;
    if (seat.sittingOut || seat.stack <= 0) return 'sittingout';
    return 'waiting';
  }

  private cardsFor(
    seat: RoomSeat,
    viewerId: string,
    engine: EnginePublicState | null,
    detail: SeatPublic | undefined,
  ): (string | null)[] {
    if (!engine || !detail) return [];
    if (seat.playerId === viewerId) return engine.you.hole ?? [];
    const shown = this.revealed.get(seat.playerId);
    if (shown) return shown;
    if (detail.status === 'folded') return [];
    return Array.from({ length: this.spec.holeCards }, () => null); // face-down
  }

  private fairnessFor(live: boolean): FairnessSnapshot | null {
    const round = live ? this.game?.roundInfo() : undefined;
    if (!round) return null;
    const settled = this.phase === 'SHOWDOWN';
    return {
      roundId: round.roundId,
      serverCommit: round.serverCommit,
      // The seed is revealed only after the hand — before that it would give the deck away.
      ...(settled
        ? {
            serverSeed: round.serverSeed,
            futureBlockHash: round.futureBlockHash,
            finalSeed: round.finalSeed,
          }
        : {}),
    };
  }

  private describeAction(action: Action): string {
    switch (action.type) {
      case 'fold':
        return 'Fold';
      case 'check':
        return 'Check';
      case 'call':
        return 'Call';
      case 'raise':
        return `Raise to ${chips(action.amount ?? 0)}`;
      default:
        return '';
    }
  }

  private describeResult(result: HandResult): string {
    const top = [...result.payouts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) return '';
    const [playerId, amount] = top;
    const name = this.seatOf(playerId)?.name ?? 'Player';
    const shown = result.showdown.find((entry) => entry.id === playerId);
    const hand = shown ? CATEGORY[shown.rank.category] : undefined;
    const others = result.payouts.size - 1;
    const split = others > 0 ? ` (split ${others + 1} ways)` : '';
    return hand
      ? `${name} wins ${chips(amount)} with ${hand}${split}`
      : `${name} wins ${chips(amount)}${split}`;
  }

  // ── Small helpers ───────────────────────────────────────────────────────────

  private occupied(): RoomSeat[] {
    return this.seats.filter((s): s is RoomSeat => s !== null);
  }

  /** Seats that should be dealt the next hand. */
  private readySeats(): RoomSeat[] {
    return this.occupied().filter((s) => !s.sittingOut && !s.leaveAfterHand && s.stack > 0);
  }

  private seatOf(playerId: string): RoomSeat | undefined {
    return this.occupied().find((s) => s.playerId === playerId);
  }

  private requireSeat(playerId: string): RoomSeat {
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('you are not seated at this table');
    return seat;
  }

  /** The button moves one live seat clockwise each hand. */
  private nextButton(players: RoomSeat[]): number {
    const after = players.find((s) => s.index > this.buttonSeat);
    return (after ?? players[0]!).index;
  }

  private toActPlayer(): string | null {
    if (!this.game || this.phase !== 'IN_HAND') return null;
    return (this.game.getPublicState('') as EnginePublicState).toAct;
  }

  private streetOf(): Street | null {
    return this.game?.handStreet() ?? null;
  }

  /** One promise chain for commands AND timers: no interleaving, no half-applied hands. */
  private enqueue(fn: () => Promise<void> | void): Promise<void> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {}); // a rejected command must not poison the queue
    return run;
  }

  /** Stop every timer. Call when shutting the table down. */
  dispose(): void {
    this.disposed = true;
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.showdownTimer) clearTimeout(this.showdownTimer);
    for (const seat of this.occupied()) this.clearAwayTimers(seat);
    this.clearActionClock();
    this.viewers.clear();
  }
}

function chips(amount: number): string {
  return `₮${amount.toLocaleString('en-US')}`;
}
