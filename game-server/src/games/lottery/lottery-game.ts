import { BaseGame, InvalidActionError } from '../../core/base-game';
import { EventBus } from '../../core/event-bus';
import type { FinancialCoreClient, JackpotAccounts } from '../../core/financial-core-client';
import {
  computeFinalSeed,
  awaitFutureBlockHash,
  generateClientSeed,
  generateServerCommitment,
  mergeClientSeeds,
  type ChainClient,
  type SeatedClientSeed,
} from '../../fairness';
import { uint32Stream, uniformBelow } from '../../fairness/rng';
import { proRataSplit } from '../shared/pool-split';
import { settleNet, toTableSettlementRequest } from '../texas/settlement';

/**
 * LotteryGame — a pari-mutuel draw. Players buy tickets on a number; when the draw lands, everyone
 * holding the winning number splits the losers' stakes pro-rata by what they staked.
 *
 * Player-funded end to end: the prize IS the losing pool, so the platform is never the banker and
 * carries no exposure — it takes only a rake. The winning number is drawn from a final seed mixing
 * the server seed, the players' client seeds and a future block hash, so nobody (us included) knows
 * it while tickets are still on sale. A draw with no winner (or no loser) voids and refunds.
 */

export type LotteryPhase = 'OPEN' | 'DRAWN';

export interface LotteryAction {
  type: 'buyTicket';
  number: number;
  amount: number;
}

export interface Ticket {
  playerId: string;
  number: number;
  amount: number;
}

export interface LotteryGameEvents extends Record<string, unknown> {
  drawn: { roundId: string; winningNumber: number; net: Record<string, number>; void: boolean };
}

export interface LotteryGameConfig {
  /** Tickets carry a number in [0, range). */
  range: number;
  rakeBps: number;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  accountOf: (playerId: string) => string;
  jackpotAccounts: JackpotAccounts;
}

/** The winning number, drawn uniformly (no modulo bias) from the round's final seed. */
export function drawNumber(finalSeed: string, range: number): number {
  return uniformBelow(uint32Stream(finalSeed), range);
}

/**
 * GROSS nets for a draw (sum exactly zero; the rake is applied later by settleNet).
 * A player may hold several tickets — wins and losses net together.
 * Returns an empty map when the draw voids (nobody won, or nobody lost).
 */
export function resolveDraw(tickets: readonly Ticket[], winningNumber: number): Map<string, number> {
  const winners = tickets.filter((t) => t.number === winningNumber);
  const losers = tickets.filter((t) => t.number !== winningNumber);
  const losingPool = losers.reduce((a, t) => a + t.amount, 0);
  if (winners.length === 0 || losingPool === 0) return new Map();

  const net = proRataSplit(losingPool, winners);
  for (const t of losers) net.set(t.playerId, (net.get(t.playerId) ?? 0) - t.amount);
  return net;
}

export class LotteryGame extends BaseGame<LotteryPhase, LotteryAction, LotteryGameEvents> {
  readonly minPlayers = 2;
  readonly maxPlayers = 10_000;

  private readonly cfg: LotteryGameConfig;
  private readonly chain: ChainClient;
  private readonly tickets: Ticket[] = [];
  private winningNumber: number | undefined;
  private net = new Map<string, number>();
  private readonly roundId: string;

  constructor(
    roomId: string,
    fc: FinancialCoreClient,
    events: EventBus<LotteryGameEvents>,
    chain: ChainClient,
    cfg: LotteryGameConfig,
  ) {
    super(roomId, fc, events, { initial: 'OPEN', transitions: { OPEN: ['DRAWN'], DRAWN: [] } });
    this.cfg = cfg;
    this.chain = chain;
    this.roundId = `${roomId}-lot`;
  }

  buyTicket(playerId: string, num: number, amount: number): void {
    if (!this.sm.is('OPEN')) throw new InvalidActionError('the draw has closed');
    if (!Number.isInteger(num) || num < 0 || num >= this.cfg.range) {
      throw new InvalidActionError('number out of range');
    }
    if (!Number.isInteger(amount) || amount <= 0) throw new InvalidActionError('stake must be positive');
    this.tickets.push({ playerId, number: num, amount });
  }

  handleAction(playerId: string, action: LotteryAction): void {
    if (action.type !== 'buyTicket') throw new InvalidActionError('unknown action');
    this.buyTicket(playerId, action.number, action.amount);
  }

  /** Close sales, draw the number, split the pool, and settle through the FC. */
  async start(_players: string[] = []): Promise<void> {
    if (!this.sm.is('OPEN')) throw new InvalidActionError('already drawn');
    if (this.tickets.length === 0) throw new InvalidActionError('no tickets sold');

    const { serverSeed } = generateServerCommitment();
    const seats: SeatedClientSeed[] = this.tickets.map((_, i) => ({
      seatOrder: i,
      clientSeed: generateClientSeed(),
    }));
    const target = (await this.chain.getLatestBlockNumber()) + 1;
    const futureBlockHash = await awaitFutureBlockHash(this.chain, target);
    const finalSeed = computeFinalSeed(
      serverSeed,
      mergeClientSeeds(seats),
      futureBlockHash,
      this.roundId,
    );

    this.winningNumber = drawNumber(finalSeed, this.cfg.range);
    this.net = resolveDraw(this.tickets, this.winningNumber);

    if (this.net.size > 0) {
      const settlement = settleNet(this.net, { rakeBps: this.cfg.rakeBps });
      const request = toTableSettlementRequest(settlement, {
        roundId: this.roundId,
        tableType: this.cfg.tableType,
        ...(this.cfg.leagueId ? { leagueId: this.cfg.leagueId } : {}),
        accountOf: this.cfg.accountOf,
        jackpotAccounts: this.cfg.jackpotAccounts,
      });
      await this.fc.settleTableHand(request);
    }

    this.sm.transition('DRAWN');
    this.events.emit('drawn', {
      roundId: this.roundId,
      winningNumber: this.winningNumber,
      net: Object.fromEntries(this.net),
      void: this.net.size === 0,
    });
  }

  getWinningNumber(): number | undefined {
    return this.winningNumber;
  }
  getNet(): Map<string, number> {
    return new Map(this.net);
  }
  getTickets(): readonly Ticket[] {
    return this.tickets;
  }
  /** Total staked so far — the prize on offer. */
  getPool(): number {
    return this.tickets.reduce((a, t) => a + t.amount, 0);
  }

  getPublicState(forPlayerId: string): unknown {
    return {
      phase: this.state,
      pool: this.getPool(),
      ticketsSold: this.tickets.length,
      yourTickets: this.tickets.filter((t) => t.playerId === forPlayerId),
      yourNet: this.net.get(forPlayerId) ?? null,
      winningNumber: this.sm.is('DRAWN') ? this.winningNumber : null,
    };
  }
}
