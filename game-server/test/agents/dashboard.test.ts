import {
  windowFor,
  activityFor,
  isAgentRange,
  AGENT_RANGES,
  ACTIVE_WITHIN_DAYS,
  DORMANT_WITHIN_DAYS,
} from '../../src/agents/dashboard';

/**
 * The dashboard's two rules (§13.4): what a named period covers, and when a
 * player stops counting as active.
 *
 * Both look cosmetic and are not. The window decides which settlement records
 * a total is drawn from, so an agent reconciling Tab 1 against Tab 4 needs both
 * tabs to agree on it. The activity boundary decides a colour agents make
 * retention decisions on.
 */

const at = (iso: string): Date => new Date(iso);

describe('windowFor — what a named range covers', () => {
  // A Wednesday, mid-afternoon UTC.
  const now = at('2026-08-05T14:30:00.000Z');

  it('starts "today" at midnight UTC, not 24 hours ago', () => {
    // A rolling 24h window would count yesterday evening's hands as today's,
    // and the total would disagree with the settlement records listed under it.
    const { from, to } = windowFor('today', now);
    expect(from.toISOString()).toBe('2026-08-05T00:00:00.000Z');
    expect(to).toBe(now);
  });

  it('covers 7 days INCLUDING today for "week"', () => {
    const { from } = windowFor('week', now);
    expect(from.toISOString()).toBe('2026-07-30T00:00:00.000Z');
  });

  it('does not reset the week on a Monday', () => {
    // A calendar week would show a Monday-morning agent almost nothing and read
    // as commission that went missing over the weekend.
    const monday = at('2026-08-03T09:00:00.000Z');
    const { from } = windowFor('week', monday);
    expect(from.toISOString()).toBe('2026-07-28T00:00:00.000Z');
  });

  it('covers 30 days including today for "30d"', () => {
    const { from } = windowFor('30d', now);
    expect(from.toISOString()).toBe('2026-07-07T00:00:00.000Z');
  });

  it('reaches back before any real round for "all"', () => {
    const { from } = windowFor('all', now);
    expect(from.getTime()).toBeLessThan(at('2021-01-01T00:00:00.000Z').getTime());
  });

  it('crosses month and year boundaries correctly', () => {
    const newYear = at('2026-01-02T03:00:00.000Z');
    expect(windowFor('week', newYear).from.toISOString()).toBe('2025-12-27T00:00:00.000Z');
  });

  it('accepts exactly the four ranges the spec names', () => {
    expect([...AGENT_RANGES]).toEqual(['today', 'week', '30d', 'all']);
    expect(isAgentRange('week')).toBe(true);
    expect(isAgentRange('fortnight')).toBe(false);
    expect(isAgentRange(undefined)).toBe(false);
  });
});

describe('activityFor — green / yellow / grey (§13.4 Tab 2)', () => {
  const now = at('2026-08-05T12:00:00.000Z');
  const daysAgo = (n: number): string => new Date(now.getTime() - n * 86_400_000).toISOString();

  it('is ACTIVE with volume in the last 7 days', () => {
    expect(activityFor(daysAgo(0), now)).toBe('ACTIVE');
    expect(activityFor(daysAgo(6.9), now)).toBe('ACTIVE');
  });

  it('is DORMANT between 7 and 30 days', () => {
    expect(activityFor(daysAgo(ACTIVE_WITHIN_DAYS), now)).toBe('DORMANT');
    expect(activityFor(daysAgo(29.9), now)).toBe('DORMANT');
  });

  it('is CHURNED beyond 30 days', () => {
    expect(activityFor(daysAgo(DORMANT_WITHIN_DAYS), now)).toBe('CHURNED');
    expect(activityFor(daysAgo(400), now)).toBe('CHURNED');
  });

  it('treats a player who never played as CHURNED, not ACTIVE', () => {
    // Registered and never played is the outcome an agent most needs to see.
    // Defaulting unknown to "fine" would hide exactly the players worth chasing.
    expect(activityFor(null, now)).toBe('CHURNED');
  });
});
