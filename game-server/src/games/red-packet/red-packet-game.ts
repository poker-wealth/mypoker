import { BaseGame, InvalidActionError } from '../../core/base-game';
import { EventBus } from '../../core/event-bus';
import type { FinancialCoreClient, JackpotAccounts } from '../../core/financial-core-client';
import { generateServerCommitment } from '../../fairness';
import { settleNet, toTableSettlementRequest } from '../texas/settlement';
import { generateMineGrid, gridCommit, safeMultiplierBps } from './mine-grid';

/**
 * RedPacketGame (红包扫雷) — PLAYER-BANKED minesweeper betting.
 *
 * A player banks the round. The mine grid is generated from a server seed and COMMITTED (hash)
 * before anyone bets — so the mines can't be moved afterward. Bettors pick a cell and stake; when
 * the round reveals, a bet on a safe cell wins its multiplier from the banker, a bet on a mine
 * loses to the banker. All bettor nets are offset by the banker (sum to zero); the platform takes
 * only a rake and settles through the shared player-funded path.
 */

export type RedPacketPhase = 'BETTING' | 'RESOLVED';

export interface RedPacketAction {
  type: 'bet';
  cell: number;
  amount: number;
}

export interface RedPacketGameEvents extends Record<string, unknown> {
  resolved: { roundId: string; serverSeed: string; mines: number[]; net: Record<string, number> };
}

export interface RedPacketGameConfig {
  size: number;
  mineCount: number;
  rakeBps: number;
  tableType: 'PLATFORM' | 'LEAGUE';
  leagueId?: string;
  accountOf: (playerId: string) => string;
  jackpotAccounts: JackpotAccounts;
  /** Test-only: fix the server seed for a deterministic grid. Random in production. */
  serverSeed?: string;
}

export class RedPacketGame extends BaseGame<RedPacketPhase, RedPacketAction, RedPacketGameEvents> {
  readonly minPlayers = 2;
  readonly maxPlayers = 20;

  private readonly cfg: RedPacketGameConfig;
  private readonly serverSeed: string;
  private readonly commit: string;
  private readonly mines: Set<number>;
  private banker: string | undefined;
  private readonly bets = new Map<string, { cell: number; amount: number }>();
  private net = new Map<string, number>();
  private readonly roundId: string;

  constructor(
    roomId: string,
    fc: FinancialCoreClient,
    events: EventBus<RedPacketGameEvents>,
    cfg: RedPacketGameConfig,
  ) {
    super(roomId, fc, events, {
      initial: 'BETTING',
      transitions: { BETTING: ['RESOLVED'], RESOLVED: [] },
    });
    this.cfg = cfg;
    this.roundId = `${roomId}-rp`;
    // Grid fixed and committed at construction — BEFORE any bet.
    this.serverSeed = cfg.serverSeed ?? generateServerCommitment().serverSeed;
    this.commit = gridCommit(this.serverSeed);
    this.mines = generateMineGrid(this.serverSeed, cfg.size, cfg.mineCount);
  }

  /** The pre-bet grid commitment (publish this before accepting bets). */
  getCommit(): string {
    return this.commit;
  }

  setBanker(playerId: string): void {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('betting is closed');
    this.banker = playerId;
    this.bets.delete(playerId);
  }

  placeBet(playerId: string, cell: number, amount: number): void {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('betting is closed');
    if (playerId === this.banker) throw new InvalidActionError('the banker cannot bet');
    if (!Number.isInteger(cell) || cell < 0 || cell >= this.cfg.size) {
      throw new InvalidActionError('cell out of range');
    }
    if (amount <= 0) throw new InvalidActionError('bet must be positive');
    this.bets.set(playerId, { cell, amount });
  }

  handleAction(playerId: string, action: RedPacketAction): void {
    if (action.type !== 'bet') throw new InvalidActionError('unknown action');
    this.placeBet(playerId, action.cell, action.amount);
  }

  /** Reveal the grid, resolve every bet against the banker, and settle through the FC. */
  async start(_players: string[] = []): Promise<void> {
    if (!this.sm.is('BETTING')) throw new InvalidActionError('already resolved');
    if (!this.banker) throw new InvalidActionError('no banker designated');
    if (this.bets.size === 0) throw new InvalidActionError('no bets placed');

    const multBps = safeMultiplierBps(this.cfg.size, this.cfg.mineCount);
    this.net = new Map();
    let bankerNet = 0;
    for (const [playerId, { cell, amount }] of this.bets) {
      const hitMine = this.mines.has(cell);
      const g = hitMine ? -amount : Math.floor((amount * (multBps - 10000)) / 10000);
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
      serverSeed: this.serverSeed, // revealed now — verifies against the pre-bet commit
      mines: [...this.mines].sort((a, b) => a - b),
      net: Object.fromEntries(this.net),
    });
  }

  getNet(): Map<string, number> {
    return new Map(this.net);
  }
  /** Revealed only after the round resolves. */
  reveal(): { serverSeed: string; mines: number[] } | null {
    return this.sm.is('RESOLVED')
      ? { serverSeed: this.serverSeed, mines: [...this.mines].sort((a, b) => a - b) }
      : null;
  }

  getPublicState(forPlayerId: string): unknown {
    const revealed = this.sm.is('RESOLVED');
    return {
      phase: this.state,
      commit: this.commit, // known before bets; the grid can be verified after reveal
      banker: this.banker ?? null,
      yourBet: this.bets.get(forPlayerId) ?? null,
      yourNet: this.net.get(forPlayerId) ?? null,
      mines: revealed ? [...this.mines].sort((a, b) => a - b) : undefined,
      serverSeed: revealed ? this.serverSeed : undefined,
    };
  }
}
