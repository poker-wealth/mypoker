import { EventBus } from '../core/event-bus';
import { DouDiZhuGame } from '../games/dou-di-zhu/dou-di-zhu-game';
import { validateMove } from '../games/dou-di-zhu/validator';
import { classifyPlay, type Combo } from '../games/dou-di-zhu/combos';
import { cardRank } from '../games/dou-di-zhu/ddz-deck';
import { settleNet } from '../games/texas/settlement';
import { BaseLiveRoom, RoomError, tableJackpotAccounts, type BaseRoomSeat } from './base-room';
import type { LiveTableConfig, RoomDeps } from './live-room';
import type { TableSnapshot, TableSummary } from './room-state';

export interface DouDiZhuRoomConfig extends LiveTableConfig {
  id: string;
  name: string;
  game: 'dou-di-zhu';
  baseStake: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: 3;
  rakeBps: number;
  showdownDelayMs?: number;
}

type RoomSeat = BaseRoomSeat;

/** What `DouDiZhuGame.getPublicState()` returns, typed at the seam rather than cast to `any`. */
interface DdzPublicState {
  phase: 'BIDDING' | 'PLAYING' | 'FINISHED';
  landlord: string | null;
  turn: string | null;
  currentPlay: { cards: string[]; by: string } | null;
  yourHand: string[] | null;
  handCounts: Record<string, number>;
}

export class DouDiZhuRoom extends BaseLiveRoom<DouDiZhuRoomConfig, RoomSeat> {
  private game: DouDiZhuGame;
  private showdownTimer: NodeJS.Timeout | null = null;

  constructor(config: DouDiZhuRoomConfig, deps: RoomDeps) {
    super(config, deps);
    this.requireNumbers('rakeBps', 'baseStake');

    this.game = new DouDiZhuGame(
      config.id,
      this.fc,
      new EventBus(),
      this.chain,
      {
        baseStake: config.baseStake,
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

  protected async handleAct(
    playerId: string,
    action: { type: string; amount?: number; cards?: string[] },
  ): Promise<void> {
    if (this.phase !== 'IN_HAND') throw new RoomError('not in hand');
    const seat = this.seatOf(playerId);
    if (!seat) throw new RoomError('not seated');
    if (this.game.getTurn() !== playerId) throw new RoomError('not your turn');

    if (action.type.startsWith('bid-')) {
      const points = Number(action.type.slice(4));
      if (!Number.isInteger(points)) throw new RoomError('bid must be 0 to 3');
      this.game.bid(playerId, points);
    } else if (action.type === 'play') {
      const cards = action.cards ?? [];
      const hand = [...(this.game.handOf(playerId) ?? [])];
      const res = validateMove(cards, this.comboToBeat(playerId), hand);
      if (!res.valid) throw new RoomError(res.reason ?? 'invalid move');
      try {
        // AWAITED (BUG-25): this used to fire-and-forget. `play()` settles through `finish()` when
        // it empties a hand, and an unawaited settlement rejection is an unhandled rejection —
        // process-fatal in Node 15+. Worse, because `winner` is set synchronously before `finish()`
        // awaits anything, the `getWinner()` check below used to fire and mirror stacks in
        // `resolveRound` regardless of whether the settlement it raced actually landed.
        await this.game.play(playerId, cards);
      } catch (err) {
        // A throw with the winner already set came from settlement inside `finish()`, not from an
        // illegal play — the play itself already landed and emptied the hand. Treat it exactly like
        // `resolveRound`'s own settlement failure: WAITING, nothing mirrored, failure reported. A
        // throw with no winner is the engine rejecting the play itself (state the checks above did
        // not catch, e.g. still bidding) and belongs to the player, not the table.
        if (this.game.getWinner()) {
          // BUG-20: the settlement may have committed in FC even though `play()` threw (a lost
          // response, not a refusal). Ask before abandoning a hand the ledger already paid.
          const nets = this.game.getNet();
          const attempted = nets.size > 0 ? settleNet(nets, { rakeBps: this.config.rakeBps }) : undefined;
          if (attempted && (await this.settledDespite(err, this.game.roundInfo()?.roundId, attempted))) {
            // Proceed exactly as the happy path below would: `resolveRound` mirrors the stacks and
            // draws the jackpot from the game's own state — it never calls FC again, so this cannot
            // double-mirror or double-run the jackpot evaluation.
            await this.resolveRound();
            return;
          }
          this.abandonRoundAndRedeal(err);
          return;
        }
        throw err;
      }
    } else if (action.type === 'pass') {
      await this.game.pass(playerId);
    } else {
      throw new RoomError(`unknown action: ${action.type}`);
    }

    if (this.game.getWinner()) {
      await this.resolveRound();
    } else {
      this.push();
    }
  }

  protected onSeatChanged(): void {
    this.maybeStartRound();
  }

  /** No per-trick wager to check (D4, BUG-07 follow-up) — a round in progress is the only thing a
   *  Dou Di Zhu seat can be committed to. */
  protected override seatCommitted(): boolean {
    return this.phase !== 'WAITING';
  }

  // ── Reading the table ───────────────────────────────────────────────────────

  /**
   * The combination this player has to beat, or null when the lead is theirs.
   *
   * Re-derived from the cards on the table because `getPublicState` publishes the played cards and
   * not their classification. Reading `currentPlay.combo` (which does not exist) made this null on
   * every turn, so a play that could not legally beat the trick was waved through by the room and
   * left for the engine to refuse.
   */
  private comboToBeat(playerId: string): Combo | null {
    const play = this.publicState(playerId).currentPlay;
    if (!play || play.by === playerId) return null;
    return classifyPlay(play.cards.map(cardRank));
  }

  private publicState(forPlayerId: string): DdzPublicState {
    return this.game.getPublicState(forPlayerId) as DdzPublicState;
  }

  private async maybeStartRound(): Promise<void> {
    if (this.phase !== 'WAITING') return;
    const occupied = this.occupiedSeats();
    // A seat on its way out (D6, BUG-07 follow-up) doesn't count toward the three this game needs,
    // and never gets dealt in — there is no way to sub a fourth player into a hand already running.
    if (occupied.length !== 3 || occupied.some((s) => s.leaving)) return;

    this.game = new DouDiZhuGame(
      this.config.id,
      this.fc,
      new EventBus(),
      this.chain,
      {
        baseStake: this.config.baseStake,
        rakeBps: this.config.rakeBps,
        tableType: 'PLATFORM',
        accountOf: (p) => p,
        jackpotAccounts: tableJackpotAccounts(this.config.id),
      },
    );

    this.phase = 'IN_HAND';
    this.handNumber++;

    for (const s of occupied) {
      s.bet = 0;
      delete s.net;
    }

    await this.game.start(occupied.map((s) => s.playerId));
    this.push();
  }

  private async resolveRound(): Promise<void> {
    // Anything from here on can throw — the ledger refusing, a jackpot pool failing to open.
    // If it does, the table goes back to WAITING rather than sitting in IN_HAND forever. See
    // `abandonRound`: nothing is paid or reversed, only the room is made playable again.
    try {
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

      /**
       * The jackpot draws on the seed the deck was shuffled with — server seed, every client seed
       * and a future block hash — so a player can verify the draw the same way they verify the deal.
       *
       * It used to draw on `${roundId}:seed`. Anyone who could read a round id could compute that,
       * and therefore know in advance whether a jackpot would fire. There is no safe fallback here:
       * if the round context is missing the draw is SKIPPED, because running it on a guessable seed
       * is the bug, not the backstop.
       */
      const round = this.game?.roundInfo();
      const roundId = round?.roundId ?? `${this.config.id}-ddz-${this.handNumber}`;
      if (round) {
        await this.processJackpot(winnerProfit, roundId, round.finalSeed);
      } else {
        console.error(
          `[room ${this.config.id}] no round context after a hand — jackpot skipped rather than drawn on a predictable seed`,
        );
      }
    } catch (err) {
      this.abandonRoundAndRedeal(err);
      return;
    }

    this.phase = 'SHOWDOWN';
    this.push();

    this.showdownTimer = setTimeout(() => {
      void this.enqueue(async () => {
        this.phase = 'WAITING';
        // Frees anyone disconnect grace queued but could not release yet (D4, BUG-07 follow-up)
        // before the next round can claim their seat as still occupied.
        await this.releaseDeparted();
        this.push();
        await this.maybeStartRound();
      });
    }, this.config.showdownDelayMs ?? 5_000);
  }

  /**
   * `abandonRound` only puts `phase` back to WAITING — nothing else deals the next hand, so without
   * this the table would sit idle with players still in their seats. Shared by `resolveRound`'s own
   * settlement failure and by `handleAct`'s (BUG-25): a settlement can fail either place, and both
   * need the same redeal beat a showdown gets.
   */
  private abandonRoundAndRedeal(err: unknown): void {
    this.abandonRound(err);
    this.showdownTimer = setTimeout(() => {
      void this.enqueue(async () => {
        await this.releaseDeparted();
        await this.maybeStartRound();
      });
    }, this.config.showdownDelayMs ?? 5_000);
  }

  /**
   * Dou Di Zhu has no blinds but does have a fixed per-round stake, so it is
   * the one inheritor that overrides this. Reported as `baseStake`, NOT as a
   * big blind — the lobby comment that claimed non-poker rooms "carry their
   * base bet in the same field" was false for years, and it was false partly
   * because there was no honest field to put it in.
   */
  protected override stakeLevel(): Pick<TableSummary, 'smallBlind' | 'bigBlind' | 'baseStake'> {
    return { smallBlind: null, bigBlind: null, baseStake: this.config.baseStake };
  }

  snapshotFor(playerId: string): TableSnapshot {
    const seat = this.seatOf(playerId);
    const pubState = this.publicState(playerId);
    const turnPlayer = this.game.getTurn();

    return {
      tableId: this.config.id,
      name: this.config.name,
      variant: 'Dou Di Zhu',
      smallBlind: 0,
      bigBlind: 0,
      minBuyIn: this.config.minBuyIn,
      maxBuyIn: this.config.maxBuyIn,
      maxSeats: this.config.maxSeats,
      phase: this.phase,
      handId: this.phase !== 'WAITING' ? `#${this.handNumber}` : null,
      handNumber: this.handNumber,
      street: null,
      // Bidding and playing are both `IN_HAND` to the hub, but the client has to know which set of
      // controls to offer — you cannot bid during a trick or play a card during the auction.
      ...(this.phase === 'IN_HAND' ? { stage: pubState.phase } : {}),
      pot: 0,
      board: pubState?.currentPlay ? pubState.currentPlay.cards : [],
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
        const isLandlord = pubState.landlord === s.playerId;
        const myHand = [...(this.game.handOf(s.playerId) ?? [])];
        const count = myHand.length;

        const cards = this.phase === 'SHOWDOWN' || s.playerId === playerId
          ? myHand
          : Array.from({ length: count }, () => null);

        let lastAction: string | undefined;
        if (isLandlord) lastAction = 'LANDLORD';

        return {
          index: s.index,
          playerId: s.playerId,
          name: s.name,
          ...(s.avatarUrl ? { avatarUrl: s.avatarUrl } : {}),
          stack: s.stack,
          bet: s.bet,
          status: turnPlayer === s.playerId ? 'active' : 'waiting',
          inHand: this.phase !== 'WAITING',
          connected: s.connected,
          isDealer: isLandlord,
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
      toActSeat: this.occupiedSeats().find((s) => s.playerId === turnPlayer)?.index ?? null,
      actionDeadline: null,
      legal: null,
      winners: this.occupiedSeats().filter((s) => (s.net ?? 0) > 0).map((s) => s.index),
      ...(this.resultMessage() ? { message: this.resultMessage()! } : {}),
      ...(this.waitingFor(3) ? { message: this.waitingFor(3)! } : {}),
      ...(this.leavingBlockedMessage() ? { message: this.leavingBlockedMessage()! } : {}),
      serverTime: Date.now(),
    };
  }

  /**
   * "Bruno (Landlord) wins" — a name, not the raw account id the old message printed.
   *
   * Returns undefined once the table is back to `WAITING` (BUG-25 follow-up): `this.game` is not
   * replaced with a fresh `DouDiZhuGame` until `maybeStartRound` deals the next hand, so
   * `getWinner()` keeps reporting the PREVIOUS hand's winner for the whole `WAITING` window —
   * including after `abandonRoundAndRedeal` sends the table back to `WAITING` on a refused
   * settlement, where nobody actually won anything and stacks never moved. Without this guard the
   * felt showed "X wins" for a full `showdownDelayMs` after a settlement failure that paid nobody.
   */
  private resultMessage(): string | undefined {
    if (this.phase === 'WAITING') return undefined;
    const winnerId = this.game.getWinner();
    if (!winnerId) return undefined;
    const seat = this.seatOf(winnerId);
    const side = this.game.getLandlord() === winnerId ? 'Landlord' : 'Peasants';
    return `${seat?.name ?? winnerId} wins — ${side}`;
  }

  /**
   * Occupied at three but still not dealing (F6, audit fix on BUG-07 follow-up) — `waitingFor(3)`
   * reads as "the table is short a player," which is false here: all three seats are full, one of
   * them just cannot be dealt in until its release clears (a `leaving` seat stuck on a refused
   * release, or one grace is still winding down). Told apart from `waitingFor` so the felt does not
   * ask a player to invite someone who is, from where they sit, already seated.
   */
  private leavingBlockedMessage(): string | undefined {
    if (this.phase !== 'WAITING') return undefined;
    const occupied = this.occupiedSeats();
    if (occupied.length !== 3 || !occupied.some((s) => s.leaving)) return undefined;
    return 'Waiting for a seat to clear before the next hand can be dealt.';
  }

  dispose(): void {
    super.dispose();
    if (this.showdownTimer) clearTimeout(this.showdownTimer);
  }
}
