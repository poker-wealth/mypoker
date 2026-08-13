import type { Severity } from './ops-dashboard';

/**
 * How much a security-log entry matters (SAMUEL.md task 3, screen 5: "each a
 * ListRow with a severity Badge").
 *
 * The log records what happened; this decides what it means. It lives in the
 * gateway with the other derivations for the same reason reputation scoring
 * does — one home, so the admin panel and any future alerting channel cannot
 * disagree about whether something was critical.
 *
 * Reuses the existing `Severity` from ops-dashboard rather than inventing a
 * second scale. Two severity vocabularies would be worse than none.
 */

/**
 * CB6 and its inline enforcement are CRITICAL, and nothing else is.
 *
 * The spec singles CB6 out — "Non-whitelist fund flow (MOST IMPORTANT)" — and
 * it is the only breaker whose trip means someone attempted a movement the
 * clearing rules forbid. Every other breaker firing is the system working as
 * designed: a pool hit its floor, a rate hit its cap, a table looked odd. Those
 * need attention, not alarm.
 *
 * Grading everything CRITICAL is the same failure as grading nothing: an
 * operator who sees red constantly stops reading it, and the one alert that
 * mattered arrives in a wall of noise.
 */
const CRITICAL_EVENTS = new Set(['ILLEGAL_FUND_FLOW', 'CIRCUIT_BREAKER_CB6']);

export function severityOf(event: string): Severity {
  if (CRITICAL_EVENTS.has(event)) return 'CRITICAL';
  if (event.startsWith('CIRCUIT_BREAKER_')) return 'WARN';
  // A deposit to the wrong contract: the player needs help, nothing is broken.
  if (event === 'NON_OFFICIAL_CONTRACT_DEPOSIT') return 'WARN';
  // An unrecognised event is worth surfacing rather than hiding. INFO, not
  // silence — a new event kind someone forgot to grade should still appear.
  return 'INFO';
}

/** A human label for an event id, so the UI is not rendering SHOUTING_SNAKE. */
export function labelOf(event: string): string {
  const breaker = /^CIRCUIT_BREAKER_(CB\d)$/.exec(event);
  if (breaker) return `Circuit breaker ${breaker[1]} tripped`;
  if (event === 'ILLEGAL_FUND_FLOW') return 'Non-whitelisted fund flow rejected';
  if (event === 'NON_OFFICIAL_CONTRACT_DEPOSIT') return 'Deposit to a non-official contract';
  return event.replace(/_/g, ' ').toLowerCase();
}
