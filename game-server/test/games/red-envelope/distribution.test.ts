import { generateRandomSplit, shufflePackets } from '../../../src/games/red-envelope/engine/distribution/randomSplit';

describe('Red Envelope Distribution', () => {
  it('should generate packets that exactly sum to the total amount', () => {
    const config = {
      totalAmount: 10000,
      packetCount: 10,
      minAmount: 100
    };
    
    for (let i = 0; i < 100; i++) {
      const packets = generateRandomSplit(config);
      const sum = packets.reduce((a, b) => a + b, 0);
      expect(sum).toBe(config.totalAmount);
      expect(packets.length).toBe(config.packetCount);
      expect(packets.every(p => p >= config.minAmount)).toBe(true);
    }
  });

  it('should handle deterministic seeded random functions', () => {
    const config = {
      totalAmount: 1000,
      packetCount: 5,
      minAmount: 10
    };
    
    // Always return 0.5 for random to ensure determinism
    const packets = generateRandomSplit(config, () => 0.5);
    
    // Expected logic with 0.5 random:
    // Packet 1: remaining = 1000. Avg = 1000/5 = 200. Upper = min(400, 1000-40=960) = 400. 
    // Range = 390. amount = 10 + Math.floor(0.5 * 391) = 10 + 195 = 205.
    
    expect(packets).toHaveLength(5);
    const sum = packets.reduce((a, b) => a + b, 0);
    expect(sum).toBe(config.totalAmount);
  });

  it('should throw an error if the total amount is too small', () => {
    expect(() => {
      generateRandomSplit({
        totalAmount: 40,
        packetCount: 5,
        minAmount: 10
      });
    }).toThrow('Total amount is too small');
  });

  it('should return a single packet if packetCount is 1', () => {
    const packets = generateRandomSplit({
      totalAmount: 500,
      packetCount: 1,
      minAmount: 10
    });
    expect(packets).toEqual([500]);
  });

  it('should successfully shuffle packets without changing the sum', () => {
    const original = [100, 200, 300, 400];
    const shuffled = shufflePackets(original, () => 0.1); // Deterministic "random"
    
    expect(shuffled.length).toBe(original.length);
    expect(shuffled.sort((a,b) => a - b)).toEqual(original.sort((a,b) => a - b));
  });
});
