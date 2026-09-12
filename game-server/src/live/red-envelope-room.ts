import { EventBus } from '../core/event-bus';
import { RedEnvelopeGame } from '../games/red-envelope/red-envelope-game';
import { settleNet } from '../games/texas/settlement';
import { BaseLiveRoom, RoomError, tableJackpotAccounts, type BaseRoomSeat } from './base-room';
import type { LiveTableConfig, RoomDeps } from './live-room';
import type { TableSnapshot } from './room-state';

/**
 * RED ENVELOPE MINESWEEPER (红包扫雷) — the live table.
 *
 * The banker lays an envelope; everyone else taps to grab one packet each.
 * A packet whose last digit is the mine digit costs its grabber a multiple of
 * it, paid to the banker. Everything else the grabber keeps, paid by the
 * banker. See `RedEnvelopeGame` for the rules and the fairness commitment.
 *
 * SEPARATE FROM `RedPacketRoom`, which runs the grid version of the same name.
 * They share nothing but a theme: there, a player picks a numbered cell and
 * mines sit under cells; here, the amounts carry the mine. Merging them would
 * mean one class with two rule sets and a flag deciding which game you are
 * playing.
 *
 * THE BANKER'S EXPOSURE IS THE WHOLE ENVELOPE. Unlike a bet-per-player table,
 * the amount at risk is known before anyone acts — it is the total the banker
 * laid — so it is checked ONCE, at the start of the round, rather than
 * re-priced on every claim. A banker who cannot cover the envelope they are
 * laying does not get to lay it.
 */

export interface RedEnvelopeRoomConfig extends LiveTableConfig {
  id: string;
  name: string;
  /*
   * THE CATALOGUE ID DOES NOT CHANGE. 'red-packet' is 红包扫雷 in the lobby, the
   * locales, the artwork and the fairness registry; this room is what that game
   * now IS. Minting a second id would put two Minesweepers in the lobby and
   * leave a player to guess which one their friends are playing.
   */
  game: 'red-packet';
  /** 总金额 — the envelope, in table chips. */
  totalAmount: number;
  /** 包数 — how many packets it splits into. */
  packetCount: number;
  /** 雷号 — the mine digit, 0-9. */
  mineNumber: number;
  /** What a mined packet costs its grabber, as a multiple of it. */
  penaltyMultiplier: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  rakeBps: number;
  claimTimeMs?: number;
  showdownDelayMs?: number;
}

interface RoomSeat extends BaseRoomSeat {
  isBanker: boolean;
  /** What this seat grabbed this round, in chips. Absent until they claim. */
  claimed?: number | undefined;
  /** Whether that packet was the mine. */
  mineHit?: boolean | undefined;
  /**
   * Waiting to bank a future round — 申请埋雷 in the reference.
   *
   * A REQUEST, not a promotion: the banker of a round in progress keeps the
   * seat until it ends, because the envelope they laid is still being claimed
   * and somebody has to be liable for it.
   */
  wantsBank?: boolean | undefined;
}

export class RedEnvelopeRoom extends BaseLiveRoom<RedEnvelopeRoomConfig, RoomSeat> {
  private game: RedEnvelopeGame;
  private claimTimer: NodeJS.Timeout | null = null;
  private showdownTimer: NodeJS.Timeout | null = null;
  /** The banker cannot cover the envelope, so no round starts. Said on the felt. */
  private underfunded = false;

  constructor(config: RedEnvelopeRoomConfig, deps: RoomDeps) {
    super(config, deps);
    this.requireNumbers('rakeBps', 'totalAmount', 'packetCount', 'mineNumber', 'penaltyMultiplier');
    this.game = this.newGame();
  }

  private newGame(): RedEnvelopeGame {
    return new RedEnvelopeGame(this.config.id, this.fc, new EventBus(), {
      totalAmount: this.config.totalAmount,
      packetCount: this.config.packetCount,
      mineNumber: this.config.mineNumber,
      penaltyMultiplier: this.config.penaltyMultiplier,
      rakeBps: this.config.rakeBps,
      tableType: 'PLATFORM',
      accountOf: (p) => p,
      jackpotAccounts: tableJackpotAccounts(this.config.id),
    });
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
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('not seated');

    // 申请埋雷 — ask to bank a future round. Allowed at any time, including
    // mid-round: it changes nothing until the current envelope is finished.
    if (action.type === 'apply-bank') {
      if (seat.isBanker) throw new RoomError('you are already the banker');
      seat.wantsBank = true;
      this.push();
      return;
    }

    if (action.type === 'cancel-bank') {
      delete seat.wantsBank;
      this.push();
      return;
    }

    if (action.type !== 'claim') throw new RoomError('unknown action');
    if (this.phase !== 'IN_HAND') throw new RoomError('no envelope to claim');
    if (seat.isBanker) throw new RoomError('the banker cannot claim their own envelope');

    // The game owns the one-claim-per-player rule and the packet order; it
    // throws for a second attempt rather than this re-deciding it here.
    const result = this.game.claim(playerId);
    seat.claimed = result.amount;
    seat.mineHit = result.mineHit;
    this.push();

    // The envelope is empty — resolve now rather than running the clock down
    // on a table with nothing left to take.
    if (this.game.remaining() === 0) {
      if (this.claimTimer) clearTimeout(this.claimTimer);
      this.claimTimer = null;
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

    /*
     * WHO BANKS. The seat already marked banker keeps it; otherwise the first
     * player who asked (申请埋雷) takes it, and failing that the first seat.
     *
     * Handing it to whoever applied — rather than always the first seat — is
     * what makes the button mean something. It is also why the application
     * survives the round it was made in.
     */
    let banker = occupied.find((s) => s.isBanker);
    if (!banker) {
      banker = occupied.find((s) => s.wantsBank) ?? occupied[0]!;
      banker.isBanker = true;
    }
    delete banker.wantsBank;

    /*
     * THE BANKER MUST COVER THE WHOLE ENVELOPE.
     *
     * Every chip in it can be grabbed by somebody else, so the total is the
     * banker's maximum loss and it is known before a single tap. Checked here,
     * once — a table that started a round it could not pay would discover that
     * at settlement, which is the worst possible moment.
     *
     * Nothing is dealt if it fails: the room stays WAITING and says why, so
     * the banker can top up or make way rather than the table silently
     * refusing to start.
     */
    if (banker.stack < this.config.totalAmount) {
      this.underfunded = true;
      this.push();
      return;
    }

    this.game = this.newGame();
    this.game.setBanker(banker.playerId);

    this.phase = 'IN_HAND';
    this.handNumber++;
    const duration = this.config.claimTimeMs ?? 15_000;
    this.actionDeadline = Date.now() + duration;

    for (const s of occupied) {
      s.bet = 0;
      delete s.claimed;
      delete s.mineHit;
      delete s.net;
    }
    this.underfunded = false;

    this.push();

    this.claimTimer = setTimeout(() => {
      void this.enqueue(() => this.resolveRound());
    }, duration);
  }

  private async resolveRound(): Promise<void> {
    if (this.phase !== 'IN_HAND') return;
    if (this.claimTimer) clearTimeout(this.claimTimer);
    this.claimTimer = null;
    this.actionDeadline = null;

    const banker = this.occupiedSeats().find((s) => s.isBanker);
    const claimers = this.occupiedSeats().filter((s) => !s.isBanker && s.claimed !== undefined);

    // Nobody took anything: nothing to settle, and the banker keeps their
    // envelope. Not an error — an envelope nobody wanted.
    if (!banker || claimers.length === 0) {
      this.phase = 'WAITING';
      this.push();
      this.scheduleNextRound();
      return;
    }

    // Anything from here can throw — the ledger refusing, a jackpot pool failing to open. If it
    // does the table returns to WAITING rather than sitting in IN_HAND forever; see `abandonRound`.
    try {
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

      const roundId = `${this.config.id}-re-${this.handNumber}`;
      // Drawn on the seed the split was generated from, so the jackpot is as verifiable as the
      // game. No fallback: without a real seed the draw is SKIPPED rather than run on a
      // guessable one, which is the bug rather than the backstop.
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
      this.scheduleNextRound();
      return;
    }

    this.phase = 'SHOWDOWN';
    this.push();
    this.scheduleNextRound();
  }

  /**
   * Hand the bank to whoever applied, then start the next round after a beat.
   *
   * The rotation happens HERE rather than in `maybeStartRound` because this is
   * the only moment the outgoing banker is provably not liable for anything —
   * the round is settled and the stacks are already updated.
   */
  private scheduleNextRound(): void {
    this.showdownTimer = setTimeout(() => {
      void this.enqueue(() => {
        const applicant = this.occupiedSeats().find((s) => s.wantsBank && !s.isBanker);
        if (applicant) {
          for (const s of this.occupiedSeats()) s.isBanker = false;
          applicant.isBanker = true;
          delete applicant.wantsBank;
        }
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
      variant: 'Red Envelope',
      smallBlind: 0,
      bigBlind: 0,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      maxSeats: this.config.maxSeats,
      phase: this.phase,
      handId: this.phase !== 'WAITING' ? `#${this.handNumber}` : null,
      handNumber: this.handNumber,
      street: null,
      /*
       * All of this is public, and all of it is already known to the table: the
       * grabs went out to every viewer as they happened, and the packet list
       * only exists here once the round has revealed it.
       *
       * The MINE DIGIT is public from the start — that is the game. Players
       * are meant to know which digit kills; what they cannot know is which
       * packet carries it, and that is fixed by the commitment before anyone
       * taps.
       */
      gameState: {
        totalAmount: this.config.totalAmount,
        packetCount: this.config.packetCount,
        remaining: this.game.remaining(),
        mineNumber: this.config.mineNumber,
        penaltyMultiplier: this.config.penaltyMultiplier,
        commit: this.game.getCommit(),
        ...(reveal ? { packets: reveal.packets, serverSeed: reveal.serverSeed } : {}),
        seats: this.occupiedSeats().map((s) => ({
          index: s.index,
          isBanker: s.isBanker,
          ...(s.wantsBank ? { wantsBank: true } : {}),
          ...(s.claimed !== undefined ? { claimed: s.claimed } : {}),
          ...(s.mineHit !== undefined ? { mineHit: s.mineHit } : {}),
          ...(s.net !== undefined ? { net: s.net } : {}),
        })),
      },
      // The envelope IS the pot: it is what is on the table to be taken.
      pot: this.config.totalAmount,
      board: [],
      seats: this.seats.map((s, idx) => {
        if (!s) {
          return {
            index: idx,
            playerId: '',
            name: '',
            stack: 0,
            bet: 0,
            status: 'sittingout' as const,
            inHand: false,
            connected: false,
            isDealer: false,
            isWinner: false,
            isYou: false,
            cards: [],
          };
        }

        // What the seat strip shows beside a name: who banks, and what they took.
        let lastAction: string | undefined;
        if (s.isBanker) lastAction = 'BANKER';
        else if (s.claimed !== undefined)
          lastAction = s.mineHit ? `MINE (${s.claimed})` : `+${s.claimed}`;
        else if (s.wantsBank) lastAction = 'APPLIED';

        return {
          index: idx,
          playerId: s.playerId,
          name: s.name,
          ...(s.avatarUrl ? { avatarUrl: s.avatarUrl } : {}),
          stack: s.stack,
          bet: 0,
          status: s.claimed !== undefined || s.isBanker ? ('active' as const) : ('waiting' as const),
          inHand: this.phase !== 'WAITING',
          connected: s.connected,
          // The banker wears the dealer button — the shared seat UI already draws
          // that, and the banker IS this game's dealer.
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
      /*
       * One message, and the most useful one first: a table that cannot start
       * because the banker is short says so, ahead of the generic wait.
       */
      ...(this.underfunded
        ? { message: `The banker needs ${this.config.totalAmount} chips to lay this envelope.` }
        : this.waitingFor(2)
          ? { message: this.waitingFor(2)! }
          : {}),
      serverTime: Date.now(),
    };
  }

  dispose(): void {
    super.dispose();
    if (this.claimTimer) clearTimeout(this.claimTimer);
    if (this.showdownTimer) clearTimeout(this.showdownTimer);
  }
}