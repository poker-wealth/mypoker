export type EnvelopeState = 'DRAFT' | 'ACTIVE' | 'SETTLING' | 'COMPLETED' | 'EXPIRED';

export interface EnvelopeCoreState {
  state: EnvelopeState;
  totalPackets: number;
  remainingPackets: number;
  expiresAt: number; // timestamp
}

export interface ClaimValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validates whether a user can claim a packet based purely on state.
 */
export function validateClaim(
  envelope: EnvelopeCoreState,
  now: number,
  hasUserAlreadyClaimed: boolean
): ClaimValidationResult {
  if (envelope.state !== 'ACTIVE') {
    return { allowed: false, reason: `Envelope is in state ${envelope.state}, not ACTIVE` };
  }

  if (now > envelope.expiresAt) {
    return { allowed: false, reason: 'Envelope has expired' };
  }

  if (envelope.remainingPackets <= 0) {
    return { allowed: false, reason: 'No packets remaining' };
  }

  if (hasUserAlreadyClaimed) {
    return { allowed: false, reason: 'User has already claimed a packet' };
  }

  return { allowed: true };
}

/**
 * Returns the next state of the envelope based on incoming actions/time.
 */
export function evaluateNextState(envelope: EnvelopeCoreState, now: number): EnvelopeState {
  if (envelope.state === 'DRAFT') return 'DRAFT';
  if (envelope.state === 'COMPLETED' || envelope.state === 'EXPIRED') return envelope.state;

  if (now > envelope.expiresAt) {
    return 'EXPIRED';
  }

  if (envelope.remainingPackets === 0 && envelope.state === 'ACTIVE') {
    // Usually moves to SETTLING while final ledgers are written, or directly to COMPLETED
    return 'SETTLING';
  }

  return envelope.state;
}
