/**
 * The seven circuit breakers (FairPlay §3.8). This registry is the catalogue; the decision logic
 * for ALL SEVEN is implemented and tested in `breakers.ts` (evaluateCB1..CB7). Enforcement status:
 *   - CB6 — LIVE inline in transfer() (every fund movement) + standalone checker.
 *   - CB4, CB5 — LIVE, evaluated against the real withdrawals collection.
 *   - CB1, CB2 — LIVE, evaluated on every insurance reserve read.
 *   - CB7 — logic complete; fires once the on-chain tx feed is wired.
 *   - CB3 — logic complete; fires once the jackpot data feed lands.
 * Each trip writes a security_log entry and an ops alert.
 *
 * `status` is not decoration. The admin Overview renders a 'planned' breaker as
 * "not running", so a stale entry here either advertises protection that is
 * absent or conceals protection that is present. CB1 and CB2 sat at 'planned'
 * after their feed landed, which is the second of those.
 */

export interface CircuitBreaker {
  id: string;
  name: string;
  trigger: string;
  action: string;
  status: 'live' | 'planned';
  /** Where the breaker becomes active (milestone / week), for the planned ones. */
  activatesAt?: string;
}

export const CIRCUIT_BREAKERS: readonly CircuitBreaker[] = [
  {
    id: 'CB1',
    name: 'Insurance pool level',
    trigger: 'INSURANCE balance < threshold (Platform $10k / League $1k)',
    action: 'Disable insurance sales (existing policies still pay out)',
    // Live: evaluated on every reserve read in wallet/insurance-reserve.ts.
    status: 'live',
  },
  {
    id: 'CB2',
    name: 'Daily payout rate',
    trigger: "Today's INSURANCE→PLAYER total > 15% of INSURANCE balance",
    action: 'Suspend insurance for 24h',
    // Live: same reserve read as CB1.
    status: 'live',
  },
  {
    id: 'CB3',
    name: 'Jackpot anomaly',
    trigger: 'Same table: Mini triggers ≥ 3 times within 1 hour',
    action: "Freeze that table's jackpot",
    status: 'planned',
    activatesAt: 'Jackpot milestone',
  },
  {
    id: 'CB4',
    name: 'Abnormal account withdrawal',
    trigger: 'Single account withdrawals in 1 hour > limit',
    action: "Freeze that account's withdrawals for 1 hour",
    status: 'live',
  },
  {
    id: 'CB5',
    name: 'Platform withdrawal rate',
    trigger: 'Platform total withdrawals in 1 hour > threshold',
    action: 'Enable withdrawal throttle (5-minute delay)',
    status: 'live',
  },
  {
    id: 'CB6',
    name: 'Non-whitelist fund flow',
    trigger: 'Any fund movement along a non-whitelisted clearing path',
    action: 'Reject immediately + security_log + ops alert',
    status: 'live', // enforced in transfer() via ClearingRules
  },
  {
    id: 'CB7',
    name: 'On-chain address mapping',
    trigger: 'On-chain tx from/to address does not match the account_type mapping',
    action: 'Abort transfer + human review',
    status: 'planned',
    activatesAt: 'On-chain integration milestone',
  },
];

export function getCircuitBreaker(id: string): CircuitBreaker | undefined {
  return CIRCUIT_BREAKERS.find((cb) => cb.id === id);
}
