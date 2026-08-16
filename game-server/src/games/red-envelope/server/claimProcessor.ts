import { RedEnvelopeModel } from './envelope.model';
import { evaluateMine } from '../engine/mine/evaluator';
import { settleClaim } from '../engine/mine/settlement';
import { toMoney } from '../engine/money/money';

export interface ProcessClaimResult {
  success: boolean;
  reason?: string;
  amountUnits?: number;
  mineHit?: boolean;
  penaltyUnits?: number;
  netChangeUnits?: number;
}

/**
 * Atomically attempts to claim a packet from an active Red Envelope.
 * 
 * Uses Mongoose `findOneAndUpdate` with query conditions to ensure concurrency safety.
 * This ensures no two concurrent requests can claim the same remaining packet count
 * and bypass the `remainingPackets > 0` invariant.
 */
export async function processClaim(
  envelopeId: string,
  playerId: string,
  nowMs: number = Date.now()
): Promise<ProcessClaimResult> {
  // Step 1: Find and lock exactly one remaining packet atomically
  // We decrement remainingPackets if it's > 0 and the envelope is ACTIVE and not expired.
  // We also check that the player hasn't already claimed in the same query by looking at the claims array.
  const envelope = await RedEnvelopeModel.findOneAndUpdate(
    {
      _id: envelopeId,
      state: 'ACTIVE',
      expiresAt: { $gt: new Date(nowMs) },
      remainingPackets: { $gt: 0 },
      'claims.playerId': { $ne: playerId },
    },
    {
      $inc: { remainingPackets: -1 }
    },
    { new: true }
  );

  if (!envelope) {
    // Determine WHY the claim failed
    const current = await RedEnvelopeModel.findById(envelopeId).lean();
    if (!current) return { success: false, reason: 'Envelope not found' };
    if (current.state !== 'ACTIVE') return { success: false, reason: `Envelope is ${current.state}` };
    if (current.expiresAt.getTime() <= nowMs) return { success: false, reason: 'Envelope expired' };
    if (current.remainingPackets <= 0) return { success: false, reason: 'No packets remaining' };
    if (current.claims.some((c: any) => c.playerId === playerId)) {
      return { success: false, reason: 'User already claimed' };
    }
    return { success: false, reason: 'Race condition lost or unknown error' };
  }

  // Step 2: The packet index we just secured is the ONE we just claimed.
  // We claimed the packet at index: (totalPackets - remainingPackets - 1)
  const packetIndex = envelope.packetCount - envelope.remainingPackets - 1;
  const rawAmountUnits = envelope.packetAmounts[packetIndex];

  if (rawAmountUnits === undefined) {
    // Should never happen if invariant holds, but fallback safely
    return { success: false, reason: 'Critical mismatch: packet index out of bounds' };
  }

  // Step 3: Evaluate mine
  const evaluation = evaluateMine(
    toMoney(rawAmountUnits),
    envelope.mineNumber,
    envelope.mineMode
  );

  // Step 4: Settle penalty
  const settlement = settleClaim(
    toMoney(rawAmountUnits),
    evaluation,
    { penaltyMultiplier: envelope.penaltyMultiplier, roundingPolicy: envelope.roundingPolicy }
  );

  // Step 5: Write the claim result back to the envelope
  // If remainingPackets is now 0, we transition to SETTLING (or COMPLETED depending on architecture).
  const isLastPacket = envelope.remainingPackets === 0;
  
  const claimRecord = {
    playerId,
    packetIndex,
    amountUnits: rawAmountUnits,
    mineHit: evaluation.mineHit,
    penaltyUnits: settlement.penaltyPaid.units,
    netChangeUnits: settlement.finalNetChange,
    claimedAt: new Date(nowMs),
  };

  const finalUpdate = await RedEnvelopeModel.findByIdAndUpdate(
    envelopeId,
    {
      $push: { claims: claimRecord },
      ...(isLastPacket ? { $set: { state: 'COMPLETED' } } : {})
    },
    { new: true }
  );

  if (!finalUpdate) {
    return { success: false, reason: 'Critical error: Failed to record finalized claim' };
  }

  return {
    success: true,
    amountUnits: rawAmountUnits,
    mineHit: evaluation.mineHit,
    penaltyUnits: settlement.penaltyPaid.units,
    netChangeUnits: settlement.finalNetChange,
  };
}
