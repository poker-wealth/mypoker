/**
 * Withdrawal state machine (FairPlay §3.6) — five states, prevents double withdrawal.
 *
 *   REQUESTED ──▶ APPROVED ──▶ BROADCASTING ──▶ CONFIRMED      (terminal, success)
 *        │            │              │
 *        └────────────┴──────────────┴────────▶ ROLLED_BACK    (terminal, refunded)
 *
 * Balance handling across the three-balance wallet (M1 Remediation §P0-04):
 *   REQUESTED    — balance NOT moved yet (risk review pending).
 *   APPROVED     — amount moved available → clearing (held, not spendable, not double-withdrawable).
 *   BROADCASTING — on-chain tx sent; amount still held in clearing.
 *   CONFIRMED    — clearing removed; ledger WITHDRAW entry PLAYER → TREASURY (funds left platform).
 *   ROLLED_BACK  — hold released back clearing → available (if any was held).
 */

export enum WithdrawalState {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  BROADCASTING = 'BROADCASTING',
  CONFIRMED = 'CONFIRMED',
  ROLLED_BACK = 'ROLLED_BACK',
}

/** Permitted forward transitions. Any state may roll back except the two terminal states. */
const ALLOWED: Readonly<Record<WithdrawalState, readonly WithdrawalState[]>> = Object.freeze({
  [WithdrawalState.REQUESTED]: [WithdrawalState.APPROVED, WithdrawalState.ROLLED_BACK],
  [WithdrawalState.APPROVED]: [WithdrawalState.BROADCASTING, WithdrawalState.ROLLED_BACK],
  [WithdrawalState.BROADCASTING]: [WithdrawalState.CONFIRMED, WithdrawalState.ROLLED_BACK],
  [WithdrawalState.CONFIRMED]: [],
  [WithdrawalState.ROLLED_BACK]: [],
});

export function canTransition(from: WithdrawalState, to: WithdrawalState): boolean {
  return ALLOWED[from].includes(to);
}

/** States in which the withdrawal amount is held in the player's clearing balance. */
export function isHeldInClearing(state: WithdrawalState): boolean {
  return state === WithdrawalState.APPROVED || state === WithdrawalState.BROADCASTING;
}
