import { BaseGame, InvalidActionError } from '../../core/base-game';
import { EventBus } from '../../core/event-bus';
import type { FinancialCoreClient, JackpotAccounts } from '../../core/financial-core-client';
import {
  generateServerCommitment,
  generateClientSeed,
  mergeClientSeeds,
  computeFinalSeed,
  awaitFutureBlockHash,
  shuffledDeck,
  type ChainClient,
  type SeatedClientSeed,
} from '../../fairness';
import { parseCard } from '../texas/hand-evaluator';
import { settleNet, toTableSettlementRequest } from '../texas/settlement';
import { distributePool, impliedOddsBps, poolTotals, type PoolBet, type Side } from './odds';

/**
 * CowboyBeautyGame — head-to-head draw with PARI-MUTUEL odds and a T-5s ODDS FREEZE.
 *
 * Players back Cowboy or Beauty. The odds are implied by the pools and drift as bets arrive. Five
 * seconds before the draw the room calls `freeze()`: betting closes, the odds lock, and the block
 * that will decide the round is pinned to one that has NOT been mined yet. Only afterwards is that
 * block's hash read and mixed into the final seed. So at the moment anyone could still bet, the
 * result did not yet exist — nobody can ever bet on a known outcome.
 *
 * No banker: the winning side splits the losing side's pool. The platform only rakes.
 */

export const FREEZE_SECONDS = 5;

export type CowboyPhase = 'OPEN' | 'FROZEN' | 'RESOLVED';
export type DrawWinner = Side | 'TIE';

export interface CowboyAction {
  type: 'bet';
  side: Side;
  amount: number;
}

export interface CowboyGameEvents extends Record<string, unknown> {
  oddsFrozen: { roundId: string; oddsBps: Record<Side, number | null>; drawBlock: number };
  drawn: {
    roundId: string;
    cowboyCard: string;
    beautyCard: string;
    winner: DrawWinner;
    net: Record<string, number>;
  };
}

export interface CowboyGameConfig {
  rakeBps: number;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  accountOf: (playerId: string) => string;
  jackpotAccounts: JackpotAccounts;
}

export class CowboyBeautyGame extends BaseGame<CowboyPhase, CowboyAction, CowboyGameEvents> {
  readonly minPlayers = 2;
  readonly maxPlayers = 50;

  private readonly cfg: CowboyGameConfig;
  private readonly chain: ChainClient;
  private readonly bets = new Map<string, PoolBet>();
  private frozenOddsBps: Record<Side, number | null> | undefined;
  private drawBlock = 0;
  private winner: DrawWinner | undefined;
  private cards: { cowboy: string; beauty: string } | undefined;
  private net = new Map<string, number>();
  private readonly roundId: string;
  /**
   * The seed this round was actually generated from — server seed, every client seed and a
   * future block hash, mixed. Kept rather than dropped so the jackpot can draw on it: the room
   * used to fall back to a seed derived from the round id, which any player can reproduce.
   */
  private lastFinalSeed: string | undefined;

  constructor(
    roomId: string,
    fc: FinancialCoreClient,
    events: EventBus<CowboyGameEvents>,
    chain: ChainClient,
    cfg: CowboyGameConfig,
  ) {
    super(roomId, fc, events, {
      initial: 'OPEN',
      transitions: { OPEN: ['FROZEN'], FROZEN: ['RESOLVED'], RESOLVED: [] },
    });
    this.cfg = cfg;
    this.chain = chain;
    this.roundId = `${roomId}-cb`;
  }

  placeBet(playerId: string, side: Side, amount: number): void {
    if (!this.sm.is('OPEN')) throw new InvalidActionError('odds are frozen — betting is closed');
    if (amount <= 0) throw new InvalidActionError('bet must be positive');
    this.bets.set(playerId, { playerId, side, amount });
  }

  handleAction(playerId: string, action: CowboyAction): void {
    if (action.type !== 'bet') throw new InvalidActionError('unknown action');
    this.placeBet(playerId, action.side, action.amount);
  }

  /** Live odds while betting; the locked odds once frozen. */
  getOddsBps(): Record<Side, number | null> {
    return this.frozenOddsBps ?? impliedOddsBps(poolTotals([...this.bets.values()]));
  }

  getPools(): Record<Side, number> {
    return poolTotals([...this.bets.values()]);
  }

  /** T−5s: close betting, lock the odds, and pin the (not yet mined) block that will decide it. */
  async freeze(): Promise<void> {
    if (!this.sm.is('OPEN')) throw new InvalidActionError('already frozen');
    this.frozenOddsBps = impliedOddsBps(poolTotals([...this.bets.values()]));
    this.drawBlock = (await this.chain.getLatestBlockNumber()) + 1;
    this.sm.transition('FROZEN');
    this.events.emit('oddsFrozen', {
      roundId: this.roundId,
      oddsBps: this.frozenOddsBps,
      drawBlock: this.drawBlock,
    });
  }

  /** Draw from the pinned block, resolve the pool, and settle through the FC. */
  async start(_players: string[] = []): Promise<void> {
    if (this.sm.is('OPEN')) throw new InvalidActionError('odds are not frozen yet');
    if (!this.sm.is('FROZEN')) throw new InvalidActionError('round already drawn');

    const { serverSeed } = generateServerCommitment();
    const seats: SeatedClientSeed[] = [...this.bets.keys()].map((_, i) => ({
      seatOrder: i,
      clientSeed: generateClientSeed(),
    }));
    // The deciding hash comes from the block pinned at freeze — mined after betting closed.
    const futureBlockHash = await awaitFutureBlockHash(this.chain, this.drawBlock);
    const finalSeed = computeFinalSeed(
      serverSeed,
      mergeClientSeeds(seats),
      futureBlockHash,
      this.roundId,
    );
    this.lastFinalSeed = finalSeed;

    const deck = shuffledDeck(finalSeed);
    const cowboyCard = deck[0]!;
    const beautyCard = deck[1]!;
    this.cards = { cowboy: cowboyCard, beauty: beautyCard };
    const c = parseCard(cowboyCard).rank;
    const b = parseCard(beautyCard).rank;
    this.winner = c > b ? 'COWBOY' : b > c ? 'BEAUTY' : 'TIE';

    // A tie (or a one-sided pool) voids the round: no money moves, every stake stays put.
    this.net = this.winner === 'TIE' ? new Map() : distributePool([...this.bets.values()], this.winner);
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

    this.sm.transition('RESOLVED');
    this.events.emit('drawn', {
      roundId: this.roundId,
      cowboyCard,
      beautyCard,
      winner: this.winner,
      net: Object.fromEntries(this.net),
    });
  }

  getWinner(): DrawWinner | undefined {
    return this.winner;
  }
  getCards(): { cowboy: string; beauty: string } | undefined {
    return this.cards;
  }
  getNet(): Map<string, number> {
    return new Map(this.net);
  }
  getDrawBlock(): number {
    return this.drawBlock;
  }

  getPublicState(forPlayerId: string): unknown {
    const drawn = this.sm.is('RESOLVED');
    return {
      phase: this.state,
      pools: this.getPools(),
      oddsBps: this.getOddsBps(),
      frozen: this.frozenOddsBps !== undefined,
      drawBlock: this.drawBlock || null,
      yourBet: this.bets.get(forPlayerId) ?? null,
      yourNet: this.net.get(forPlayerId) ?? null,
      winner: drawn ? this.winner : null,
      cards: drawn ? this.cards : null,
    };
  }
  /** The round's provably-fair seed, or undefined before the first round. */
  roundSeed(): string | undefined {
    return this.lastFinalSeed;
  }
}
