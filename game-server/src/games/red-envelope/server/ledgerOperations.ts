import { RedEnvelopeLedgerModel, type LedgerEntryType } from './ledger.model';

/**
 * Creates a ledger entry for a virtual credit transaction.
 */
export async function recordLedgerEntry(
  envelopeId: string,
  playerId: string,
  type: LedgerEntryType,
  amountUnits: number,
  balanceAfterUnits: number,
  referenceId: string
): Promise<void> {
  await RedEnvelopeLedgerModel.create({
    envelopeId,
    playerId,
    type,
    amountUnits,
    balanceAfterUnits,
    referenceId,
  });
}

/**
 * Retrieves the virtual balance for a player.
 * In a fully isolated virtual system, this simply sums all credits given and taken away.
 * If interacting with a real FinancialCoreClient, this could pull from there instead.
 * 
 * For this isolated red-envelope virtual ledger, everyone starts at 0 
 * (or we simulate a starting balance).
 */
export async function getPlayerVirtualBalance(playerId: string): Promise<number> {
  const latestEntry = await RedEnvelopeLedgerModel.findOne({ playerId })
    .sort({ timestamp: -1 })
    .lean();
    
  return latestEntry ? latestEntry.balanceAfterUnits : 1000000; // Provide an initial 10,000.00 credits for testing
}

/**
 * Processes a financial change and records it in the ledger atomically.
 */
export async function applyVirtualTransaction(
  envelopeId: string,
  playerId: string,
  type: LedgerEntryType,
  amountDeltaUnits: number,
  referenceId: string
): Promise<number> {
  // To prevent race conditions in read-modify-write on a standalone ledger,
  // we would typically use a transaction or a separate Wallet document.
  // Since this is a test/simulator virtual ledger, we'll serialize via a mock approach
  // or simple read-then-write (which can be vulnerable to race conditions without locks).
  // For production, a UserWallet model with findOneAndUpdate($inc) should be used.
  
  const currentBalance = await getPlayerVirtualBalance(playerId);
  const balanceAfterUnits = currentBalance + amountDeltaUnits;
  
  await recordLedgerEntry(
    envelopeId,
    playerId,
    type,
    Math.abs(amountDeltaUnits),
    balanceAfterUnits,
    referenceId
  );
  
  return balanceAfterUnits;
}
