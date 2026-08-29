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
      this.game.play(playerId, cards);
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
    if (occupied.length !== 3) return;

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
      void this.enqueue(async () => {
        this.phase = 'WAITING';
        this.push();
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
      serverTime: Date.now(),
    };
  }

  /** "Bruno (Landlord) wins" — a name, not the raw account id the old message printed. */
  private resultMessage(): string | undefined {
    const winnerId = this.game.getWinner();
    if (!winnerId) return undefined;
    const seat = this.seatOf(winnerId);
    const side = this.game.getLandlord() === winnerId ? 'Landlord' : 'Peasants';
    return `${seat?.name ?? winnerId} wins — ${side}`;
  }

  dispose(): void {
    super.dispose();
    if (this.showdownTimer) clearTimeout(this.showdownTimer);
  }
}
