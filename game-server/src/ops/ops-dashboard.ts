import { JackpotEngine } from '../jackpot/jackpot-engine';
import { TIERS, type JackpotTier } from '../jackpot/tiers';

/**
 * Ops dashboard (FairPlay §W6/W9 admin) — a READ-ONLY view over the running platform.
 *
 * It answers "what is happening right now?" for a human operator: per-table jackpot pools, which
 * tables are frozen, and a live anomaly feed (CB trips, collusion alerts, challenge failures). It
 * holds no money and can move none — it is a projection. Any action an operator takes goes through
 * the same guarded paths as everything else; the dashboard only shows.
 */

export type Severity = 'INFO' | 'WARN' | 'CRITICAL';

export interface AnomalyEvent {
  at: number;
  severity: Severity;
  kind: string; // e.g. 'CB1', 'CB3', 'COLLUSION', 'CHALLENGE_FAIL', 'WITHDRAWAL_FREEZE'
  scope: 'PLATFORM' | 'LEAGUE';
  scopeId: string; // 'PLATFORM' or a leagueId
  message: string;
  /** Whether ops still needs to act. */
  acknowledged: boolean;
}

export interface TableJackpotView {
  tableId: string;
  frozen: boolean;
  triggersLastHour: number;
  pools: Record<JackpotTier, number>;
  total: number;
}

export interface DashboardSnapshot {
  at: number;
  tables: TableJackpotView[];
  totalJackpotAcrossTables: number;
  frozenTableCount: number;
  openAnomalies: AnomalyEvent[];
  criticalCount: number;
}

export class OpsDashboard {
  private readonly engines = new Map<string, JackpotEngine>();
  private readonly anomalies: AnomalyEvent[] = [];

  /** Register a table's jackpot engine so its pools appear on the dashboard. */
  trackTable(engine: JackpotEngine): void {
    this.engines.set(engine.tableId, engine);
  }

  /** Record an anomaly (fed by circuit breakers, collusion detection, peer challenge, etc.). */
  reportAnomaly(event: Omit<AnomalyEvent, 'acknowledged'>): void {
    this.anomalies.push({ ...event, acknowledged: false });
  }

  acknowledge(index: number): void {
    const a = this.anomalies[index];
    if (a) a.acknowledged = true;
  }

  private tableView(engine: JackpotEngine, now: number): TableJackpotView {
    const pools = Object.fromEntries(TIERS.map((t) => [t, engine.pool(t)])) as Record<JackpotTier, number>;
    return {
      tableId: engine.tableId,
      frozen: engine.isFrozen(),
      triggersLastHour: engine.triggersLastHour(now),
      pools,
      total: engine.totalPool(),
    };
  }

  snapshot(now: number): DashboardSnapshot {
    const tables = [...this.engines.values()].map((e) => this.tableView(e, now));
    const open = this.anomalies.filter((a) => !a.acknowledged);
    return {
      at: now,
      tables,
      totalJackpotAcrossTables: tables.reduce((a, t) => a + t.total, 0),
      frozenTableCount: tables.filter((t) => t.frozen).length,
      openAnomalies: open,
      criticalCount: open.filter((a) => a.severity === 'CRITICAL').length,
    };
  }

  /** Anomalies for one league admin — a league sees ONLY its own scope, never the platform's. */
  leagueFeed(leagueId: string): AnomalyEvent[] {
    return this.anomalies.filter((a) => a.scope === 'LEAGUE' && a.scopeId === leagueId);
  }
}
