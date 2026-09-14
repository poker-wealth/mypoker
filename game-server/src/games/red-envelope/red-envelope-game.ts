import { BaseGame, InvalidActionError } from '../../core/base-game';
import { EventBus } from '../../core/event-bus';
import type { FinancialCoreClient, JackpotAccounts } from '../../core/financial-core-client';
import { generateServerCommitment } from '../../fairness';
import { settleNet, toTableSettlementRequest } from '../texas/settlement';
import { evaluateMine } from './engine/mine/evaluator';
import { settleClaim } from './engine/mine/settlement';
import { toMoney } from './engine/money/money';
import { splitCommit, splitFromSeed } from './packet-split';

/**
 * RED ENVELOPE MINESWEEPER (红包扫雷) — the GRAB game.
 *
 * The banker lays an envelope of `totalAmount` split into `packetCount`
 * packets, and names the mine digit (雷号). Everyone else taps to grab one
 * packet each; they keep what they got, unless its LAST DIGIT is the mine
 * digit, in which case they pay the banker a multiple of it instead.
 *
 * NOT THE SAME GAME as `games/red-packet`, which is a grid: there, players
 * pick a numbered cell and the mines sit under cells. Here the amounts
 * themselves carry the mine. Both are called 红包扫雷 in the wild; this is the
 * one the reference app runs and the one whose engine already existed in
 * `engine/` — random split, digit extractor, mine evaluator, claim settlement,
 * all pure and all unit-tested.
 *
 * WHAT THIS CLASS ADDS to that engine is the two things it had no opinion on,
 * and both are the parts that must not be got wrong:
 *
 *  1. FAIRNESS. The split is derived from a server seed and COMMITTED before
 *     any claim (`splitCommit`), then revealed. In this game the amounts are
 *     the dice — the mine is decided by a packet's last digit — so a split
 *     that could be re-rolled mid-round is a banker choosing who loses.
 *
 *  2. MONEY. The only pre-existing server layer for this game
 *     (`server/ledgerOperations.ts`) keeps its OWN ledger, grants every
 *     unknown player 10,000 credits, and documents its own read-then-write
 *     race. It is a simulator. Nothing here touches it. Settlement goes
 *     through `settleNet` + `fc.settleTableHand`, the same path every other
 *     table uses, so this game moves money exactly the way Hold'em does.
 *
 * Every bettor's net is offset by the banker, so the table sums to zero and
 * the platform takes only rake.
 */

export type RedEnvelopePhase = 'CLAIMING' | 'RESOLVED';

export interface RedEnvelopeAction {
  type: 'claim';
}

export interface RedEnvelopeGameEvents extends Record<string, unknown> {
  resolved: {
    roundId: string;
    serverSeed: string;
    packets: number[];
    mineNumber: number;
    net: Record<string, number>;
  };
}

export interface RedEnvelopeGameConfig {
  /** The whole envelope, in table chips. The banker's maximum loss. */
  totalAmount: number;
  /** 包数 — how many packets the total is split into. */
  packetCount: number;
  /** 雷号 — the digit that makes a packet a mine, 0-9. */
  mineNumber: number;
  /**
   * What a mined packet costs its claimer, as a multiple of the packet.
   *
   * 2 means "pay twice what you grabbed". The engine rounds by an explicit
   * policy rather than a bare `Math.round`, because a penalty is money and
   * which way it rounds has to be a decision, not a default.
   */
  penaltyMultiplier: number;
  rakeBps: number;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  accountOf: (playerId: string) => string;
  jackpotAccounts: JackpotAccounts;
  /** Test-only: fix the seed for a deterministic split. Random in production. */
  serverSeed?: string;
}

export interface ClaimResult {
  packetIndex: number;
  amount: number;
  mineHit: boolean;
}

export class RedEnvelopeGame extends BaseGame<
  RedEnvelopePhase,
  RedEnvelopeAction,
  RedEnvelopeGameEvents
> {
  readonly minPlayers = 2;
  readonly maxPlayers = 20;

  private readonly cfg: RedEnvelopeGameConfig;
  private readonly serverSeed: string;
  private readonly commit: string;
  private readonly packets: number[];
  private banker: string | undefined;
  /** Claims in the order they were made — the packet a player got is its index. */
  private readonly claims = new Map<string, ClaimResult>();
  private net = new Map<string, number>();
  private readonly roundId: string;

  constructor(
    roomId: string,
    fc: FinancialCoreClient,
    events: EventBus<RedEnvelopeGameEvents>,
    cfg: RedEnvelopeGameConfig,
  ) {
    super(roomId, fc, events, {
      initial: 'CLAIMING',
      transitions: { CLAIMING: ['RESOLVED'], RESOLVED: [] },
    });

    if (!Number.isInteger(cfg.mineNumber) || cfg.mineNumber < 0 || cfg.mineNumber > 9) {
      throw new RangeError('mineNumber must be a digit 0-9');
    }
    if (!Number.isInteger(cfg.packetCount) || cfg.packetCount < 1) {
      throw new RangeError('packetCount must be at least 1');
    }
    if (cfg.penaltyMultiplier <= 0) {
      throw new RangeError('penaltyMultiplier must be positive');
    }

    this.cfg = cfg;
    this.roundId = `${roomId}-re`;
    // Split fixed and committed at construction — BEFORE any claim.
    this.serverSeed = cfg.serverSeed ?? generateServerCommitment().serverSeed;
    this.commit = splitCommit(this.serverSeed);
    this.packets = splitFromSeed(this.serverSeed, cfg.totalAmount, cfg.packetCount);
  }

  /** The pre-claim commitment. Publish before accepting claims. */
  getCommit(): string {
    return this.commit;
  }

  setBanker(playerId: string): void {
    if (!this.sm.is('CLAIMING')) throw new InvalidActionError('claiming is closed');
    this.banker = playerId;
    this.claims.delete(playerId);
  }

  /** How many packets are still unclaimed. */
  remaining(): number {
    return this.packets.length - this.claims.size;
  }

  /**
   * Take the next packet.
   *
   * ORDER IS THE ONLY THING A PLAYER CONTROLS, and it is already decided by the
   * time they tap: the packets were shuffled inside the committed seed, so
   * "the next one" is not a choice the server makes when the tap arrives.
   *
   * One claim per player per round — the reference app is the same, and
   * without it the fastest tapper simply empties the envelope.
   */
  claim(playerId: string): ClaimResult {
    if (!this.sm.is('CLAIMING')) throw new InvalidActionError('claiming is closed');
    if (playerId === this.banker) throw new InvalidActionError('the banker cannot claim');
    if (this.claims.has(playerId)) throw new InvalidActionError('you already took a packet');

    const packetIndex = this.claims.size;
    const amount = this.packets[packetIndex];
    if (amount === undefined) throw new InvalidActionError('no packets left');

    /*
     * THE MINE IS THE LAST DIGIT OF THE AMOUNT.
     *
     * `LAST_WHOLE_DIGIT` with a scale of 1 reads `amount % 10` — the last digit
     * of a whole chip amount. The mode's name comes from the engine, where a
     * unit is a cent and the scale is 100; a live room's amounts are table
     * chips, which have no sub-unit, so the scale is 1 and "the last whole
     * digit" is simply the last digit. Passing the cent scale here would read
     * the tens digit instead and the game would quietly be a different game.
     */
    const evaluation = evaluateMine(toMoney(amount), this.cfg.mineNumber, 'LAST_WHOLE_DIGIT', 1);
    const result: ClaimResult = { packetIndex, amount, mineHit: evaluation.mineHit };
    this.claims.set(playerId, result);
    return result;
  }

  handleAction(playerId: string, action: RedEnvelopeAction): void {
    if (action.type !== 'claim') throw new InvalidActionError('unknown action');
    this.claim(playerId);
  }

  /** Resolve every claim against the banker and settle through the FC. */
  async start(_players: string[] = []): Promise<void> {
    if (!this.sm.is('CLAIMING')) throw new InvalidActionError('already resolved');
    if (!this.banker) throw new InvalidActionError('no banker designated');
    if (this.claims.size === 0) throw new InvalidActionError('nobody claimed');

    this.net = new Map();
    let bankerNet = 0;

    for (const [playerId, claim] of this.claims) {
      const settlement = settleClaim(
        toMoney(claim.amount),
        { checkedDigit: claim.amount % 10, mineNumber: this.cfg.mineNumber, mineHit: claim.mineHit },
        { penaltyMultiplier: this.cfg.penaltyMultiplier, roundingPolicy: 'ROUND_DOWN' },
      );
      /*
       * ROUND_DOWN on the penalty, deliberately. The rounding has to go
       * somewhere and it should not go against the player who already took the
       * mine — a half-chip in the banker's favour, every mined packet, forever,
       * is a rake nobody voted for.
       */
      const g = settlement.finalNetChange;
      this.net.set(playerId, g);
      bankerNet -= g;
    }

    this.net.set(this.banker, bankerNet);

    const settlement = settleNet(this.net, { rakeBps: this.cfg.rakeBps });
    const request = toTableSettlementRequest(settlement, {
      roundId: this.roundId,
      tableType: this.cfg.tableType,
      ...(this.cfg.leagueId ? { leagueId: this.cfg.leagueId } : {}),
      accountOf: this.cfg.accountOf,
      jackpotAccounts: this.cfg.jackpotAccounts,
    });
    await this.fc.settleTableHand(request);

    this.sm.transition('RESOLVED');
    this.events.emit('resolved', {
      roundId: this.roundId,
      serverSeed: this.serverSeed, // revealed now — verifies against the pre-claim commit
      packets: [...this.packets],
      mineNumber: this.cfg.mineNumber,
      net: Object.fromEntries(this.net),
    });
  }

  getNet(): Map<string, number> {
    return new Map(this.net);
  }

  claimOf(playerId: string): ClaimResult | null {
    return this.claims.get(playerId) ?? null;
  }

  /** Revealed only after the round resolves. */
  reveal(): { serverSeed: string; packets: number[] } | null {
    return this.sm.is('RESOLVED')
      ? { serverSeed: this.serverSeed, packets: [...this.packets] }
      : null;
  }

  getPublicState(forPlayerId: string): unknown {
    const revealed = this.sm.is('RESOLVED');
    return {
      phase: this.state,
      commit: this.commit, // known before claims; the split verifies after reveal
      banker: this.banker ?? null,
      totalAmount: this.cfg.totalAmount,
      packetCount: this.cfg.packetCount,
      mineNumber: this.cfg.mineNumber,
      remaining: this.remaining(),
      yourClaim: this.claims.get(forPlayerId) ?? null,
      yourNet: this.net.get(forPlayerId) ?? null,
      packets: revealed ? [...this.packets] : undefined,
      serverSeed: revealed ? this.serverSeed : undefined,
    };
  }
}
