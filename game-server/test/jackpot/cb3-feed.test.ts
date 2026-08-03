import { JackpotEngine, CB3_MAX_HITS, CB3_WINDOW_MS } from '../../src/jackpot/jackpot-engine';
import { usd } from '../../src/jackpot/tiers';
import type { JackpotCandidate } from '../../src/jackpot/weights';

/**
 * CB3's live feed: the Financial Core asks "how many jackpots did this table hit in the last hour?"
 * and freezes the table at three. This is the number it reads.
 */

const TABLE: JackpotCandidate[] = [
  { playerId: 'a', baseWeight: 10, behavior: 'NORMAL', associated: false },
  { playerId: 'b', baseWeight: 10, behavior: 'NORMAL', associated: false },
];
const T0 = Date.UTC(2026, 6, 15, 11, 0, 0);

describe('CB3 feed — triggersLastHour', () => {
  it('counts hits inside the last hour, and freezes the table at three', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(500_000));
    expect(e.triggersLastHour(T0)).toBe(0);

    let round = 0;
    while (!e.isFrozen() && round < 300) {
      round++;
      e.onRoundSettled({ roundId: `r${round}`, seed: 'cb3', now: T0 + round * 1000, candidates: TABLE });
    }
    expect(e.isFrozen()).toBe(true);
    expect(e.triggersLastHour(T0 + round * 1000)).toBeGreaterThanOrEqual(CB3_MAX_HITS);
  });

  it('hits older than an hour fall out of the window — a slow table is not a farming table', () => {
    const e = new JackpotEngine('t1');
    e.inject(usd(500_000));
    let round = 0;
    while (!e.isFrozen() && round < 300) {
      round++;
      e.onRoundSettled({ roundId: `r${round}`, seed: 'cb3', now: T0 + round * 1000, candidates: TABLE });
    }
    const lastHit = e.history().at(-1)!.at;
    // Look back from two hours after the last hit: the window is empty again.
    expect(e.triggersLastHour(lastHit + 2 * CB3_WINDOW_MS)).toBe(0);
  });
});
