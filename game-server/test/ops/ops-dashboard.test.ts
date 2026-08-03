import { OpsDashboard } from '../../src/ops/ops-dashboard';
import { JackpotEngine } from '../../src/jackpot/jackpot-engine';
import { usd } from '../../src/jackpot/tiers';

const NOW = Date.UTC(2026, 6, 17, 12, 0, 0);

describe('ops dashboard — jackpot pools view', () => {
  it('shows each tracked table’s pools and the platform total', () => {
    const d = new OpsDashboard();
    const t1 = new JackpotEngine('t1');
    const t2 = new JackpotEngine('t2');
    t1.inject(usd(20_000)); // $100 across pools
    t2.inject(usd(10_000)); // $50 across pools
    d.trackTable(t1);
    d.trackTable(t2);

    const snap = d.snapshot(NOW);
    expect(snap.tables).toHaveLength(2);
    expect(snap.totalJackpotAcrossTables).toBe(usd(150));
    expect(snap.tables.find((t) => t.tableId === 't1')!.pools.MINI).toBe(usd(20)); // 20% of $100
  });

  it('reports frozen tables', () => {
    const d = new OpsDashboard();
    const t = new JackpotEngine('frozen-table');
    t.inject(usd(500_000));
    // Drive CB3: land three jackpots inside the hour.
    let r = 0;
    while (!t.isFrozen() && r < 300) {
      r++;
      t.onRoundSettled({
        roundId: `r${r}`,
        seed: 'cb3',
        now: NOW + r * 1000,
        candidates: [{ playerId: 'a', baseWeight: 10, behavior: 'NORMAL', associated: false }],
      });
    }
    d.trackTable(t);
    const snap = d.snapshot(NOW + r * 1000);
    expect(snap.frozenTableCount).toBe(1);
    expect(snap.tables[0]!.frozen).toBe(true);
    expect(snap.tables[0]!.triggersLastHour).toBeGreaterThanOrEqual(3);
  });
});

describe('ops dashboard — anomaly feed', () => {
  it('surfaces open anomalies and counts the critical ones', () => {
    const d = new OpsDashboard();
    d.reportAnomaly({ at: NOW, severity: 'CRITICAL', kind: 'CB1', scope: 'PLATFORM', scopeId: 'PLATFORM', message: 'insurance below reserve' });
    d.reportAnomaly({ at: NOW, severity: 'WARN', kind: 'CHALLENGE_FAIL', scope: 'PLATFORM', scopeId: 'PLATFORM', message: 'peer challenge failed' });

    const snap = d.snapshot(NOW);
    expect(snap.openAnomalies).toHaveLength(2);
    expect(snap.criticalCount).toBe(1);
  });

  it('acknowledging an anomaly removes it from the open list', () => {
    const d = new OpsDashboard();
    d.reportAnomaly({ at: NOW, severity: 'CRITICAL', kind: 'CB3', scope: 'PLATFORM', scopeId: 'PLATFORM', message: 'jackpot farming' });
    d.acknowledge(0);
    expect(d.snapshot(NOW).openAnomalies).toHaveLength(0);
  });
});

describe('ops dashboard — league admins see ONLY their own scope', () => {
  it('a league feed contains that league’s events and nothing else', () => {
    const d = new OpsDashboard();
    d.reportAnomaly({ at: NOW, severity: 'WARN', kind: 'COLLUSION', scope: 'LEAGUE', scopeId: 'league-a', message: 'suspected pair' });
    d.reportAnomaly({ at: NOW, severity: 'WARN', kind: 'COLLUSION', scope: 'LEAGUE', scopeId: 'league-b', message: 'other league' });
    d.reportAnomaly({ at: NOW, severity: 'CRITICAL', kind: 'CB1', scope: 'PLATFORM', scopeId: 'PLATFORM', message: 'platform-only' });

    const feedA = d.leagueFeed('league-a');
    expect(feedA).toHaveLength(1);
    expect(feedA[0]!.scopeId).toBe('league-a');
    // League A never sees league B's events, nor platform-scope events.
    expect(feedA.some((e) => e.scopeId === 'league-b' || e.scope === 'PLATFORM')).toBe(false);
  });
});
