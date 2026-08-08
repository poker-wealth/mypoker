/**
 * Agent Center dashboard rules (FairPlay v5.9 §13.4).
 *
 * Two things live here that look like presentation but are actually rules, and
 * both would drift if the client owned them:
 *
 *   - What "This Week" MEANS. A client computing its own window from the
 *     browser clock gives an agent in Bangkok a different total from one in
 *     London for the same tab, and neither reconciles against the settlement
 *     records. The window is defined once, in UTC, and sent to storage.
 *
 *   - When a player counts as dormant. §13.4 fixes the boundaries at 7 and 30
 *     days; they decide a colour an agent makes retention decisions on.
 *
 * Neither touches money. These select and label rows that settlement already
 * wrote.
 */

/** The four periods §13.4 offers on Tab 1 and Tab 4. */
export const AGENT_RANGES = ['today', 'week', '30d', 'all'] as const;
export type AgentRange = (typeof AGENT_RANGES)[number];

export const isAgentRange = (v: unknown): v is AgentRange =>
  typeof v === 'string' && (AGENT_RANGES as readonly string[]).includes(v);

/** Platform launch floor for "All Time" — comfortably before any real round. */
const EPOCH = new Date('2020-01-01T00:00:00.000Z');

const startOfUtcDay = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/**
 * The window a range covers, in UTC, inclusive of `to`.
 *
 * "Week" is the last 7 days including today rather than a calendar week that
 * starts on a Monday: an agent checking on Monday morning should not see their
 * week reset to near-zero, which is what a calendar week does and what makes
 * the number read as lost commission.
 */
export function windowFor(range: AgentRange, now = new Date()): { from: Date; to: Date } {
  const to = now;
  switch (range) {
    case 'today':
      return { from: startOfUtcDay(now), to };
    case 'week': {
      const from = startOfUtcDay(now);
      from.setUTCDate(from.getUTCDate() - 6);
      return { from, to };
    }
    case '30d': {
      const from = startOfUtcDay(now);
      from.setUTCDate(from.getUTCDate() - 29);
      return { from, to };
    }
    case 'all':
      return { from: EPOCH, to };
  }
}

/** §13.4 Tab 2's colour coding. */
export type ActivityStatus = 'ACTIVE' | 'DORMANT' | 'CHURNED';

export const ACTIVE_WITHIN_DAYS = 7;
export const DORMANT_WITHIN_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Green / yellow / grey, from when the player last generated volume.
 *
 * A player who has never generated any is CHURNED rather than ACTIVE — they
 * registered and never played, which is the outcome an agent most needs to see
 * and the one an "unknown means fine" default would hide.
 */
export function activityFor(lastActiveAt: string | null, now = new Date()): ActivityStatus {
  if (!lastActiveAt) return 'CHURNED';

  const elapsedDays = (now.getTime() - new Date(lastActiveAt).getTime()) / DAY_MS;
  if (elapsedDays < ACTIVE_WITHIN_DAYS) return 'ACTIVE';
  if (elapsedDays < DORMANT_WITHIN_DAYS) return 'DORMANT';
  return 'CHURNED';
}
