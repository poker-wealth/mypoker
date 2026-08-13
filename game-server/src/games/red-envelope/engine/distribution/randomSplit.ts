export interface SplitConfig {
  totalAmount: number;
  packetCount: number;
  minAmount: number;
}

/**
 * Distributes a total amount into N packets using a bounded random approach.
 * Returns an array of integer amounts.
 * 
 * Invariants:
 * 1. Sum of returned amounts === totalAmount
 * 2. Every returned amount >= minAmount
 * 3. Exact packetCount
 */
export function generateRandomSplit(
  config: SplitConfig,
  randomFn: () => number = Math.random
): number[] {
  const { totalAmount, packetCount, minAmount } = config;

  if (packetCount < 1) {
    throw new Error('Packet count must be at least 1');
  }
  if (totalAmount < packetCount * minAmount) {
    throw new Error('Total amount is too small to satisfy the minimum amount per packet');
  }

  if (packetCount === 1) {
    return [totalAmount];
  }

  const packets: number[] = [];
  let remainingAmount = totalAmount;

  for (let i = 0; i < packetCount - 1; i++) {
    const remainingPackets = packetCount - i;
    
    // The maximum we can give to the current packet is the remaining amount 
    // minus what's needed for the rest of the packets at minimum.
    const maxSafeAmount = remainingAmount - ((remainingPackets - 1) * minAmount);
    
    // If we just do simple random between minAmount and maxSafeAmount, the first packets 
    // might consume too much, leaving the last packets exactly at minAmount.
    // A standard "Red Envelope" algorithm bounds the max to 2 * (remainingAmount / remainingPackets)
    // to maintain fairness, but we must cap it at maxSafeAmount.
    const averageRemaining = Math.floor(remainingAmount / remainingPackets);
    const upperLimit = Math.min(averageRemaining * 2, maxSafeAmount);
    
    // Pick a random integer between minAmount and upperLimit (inclusive)
    const range = upperLimit - minAmount;
    const packetAmount = minAmount + Math.floor(randomFn() * (range + 1));

    packets.push(packetAmount);
    remainingAmount -= packetAmount;
  }

  // The final packet gets exactly the remaining amount to ensure the sum is exactly totalAmount.
  packets.push(remainingAmount);

  return packets;
}

/**
 * Shuffles the packet array so the distribution algorithm's shape (larger variance early on)
 * doesn't dictate the actual claim order.
 */
export function shufflePackets(packets: number[], randomFn: () => number = Math.random): number[] {
  const shuffled = [...packets];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}
