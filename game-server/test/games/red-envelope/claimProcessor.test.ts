import { processClaim } from '../../../src/games/red-envelope/server/claimProcessor';
import { RedEnvelopeModel } from '../../../src/games/red-envelope/server/envelope.model';

jest.mock('../../../src/games/red-envelope/server/envelope.model', () => {
  return {
    RedEnvelopeModel: {
      findOneAndUpdate: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    }
  };
});

describe('Red Envelope Claim Processor', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully process a claim and push to the claims array', async () => {
    // Mock the exact atomic return of findOneAndUpdate
    (RedEnvelopeModel.findOneAndUpdate as jest.Mock).mockResolvedValueOnce({
      _id: 'env1',
      packetCount: 5,
      remainingPackets: 4, // it decreased by 1
      packetAmounts: [1000, 2000, 1500, 2500, 3000],
      mineNumber: 7,
      mineMode: 'LAST_DECIMAL_DIGIT',
      penaltyMultiplier: 1.5,
      roundingPolicy: 'ROUND_HALF_UP',
      claims: []
    });

    (RedEnvelopeModel.findByIdAndUpdate as jest.Mock).mockResolvedValueOnce(true);

    const result = await processClaim('env1', 'player1', 1000);

    expect(result.success).toBe(true);
    // packetIndex = 5 - 4 - 1 = 0. Amount = 1000. mineHit = 0 === 7 (false)
    expect(result.amountUnits).toBe(1000);
    expect(result.mineHit).toBe(false);
    expect(result.penaltyUnits).toBe(0);
    expect(result.netChangeUnits).toBe(1000);

    expect(RedEnvelopeModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'env1', state: 'ACTIVE' }),
      { $inc: { remainingPackets: -1 } },
      { new: true }
    );
    
    // The final update should record the claim
    expect(RedEnvelopeModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'env1',
      {
        $push: { claims: expect.objectContaining({ playerId: 'player1', amountUnits: 1000 }) }
      },
      { new: true }
    );
  });

  it('should detect a mine hit and apply penalty', async () => {
    (RedEnvelopeModel.findOneAndUpdate as jest.Mock).mockResolvedValueOnce({
      _id: 'env2',
      packetCount: 5,
      remainingPackets: 3, // index = 5 - 3 - 1 = 1
      packetAmounts: [1000, 2007, 1500, 2500, 3000],
      mineNumber: 7,
      mineMode: 'LAST_DECIMAL_DIGIT',
      penaltyMultiplier: 2.0,
      roundingPolicy: 'ROUND_HALF_UP',
      claims: []
    });

    (RedEnvelopeModel.findByIdAndUpdate as jest.Mock).mockResolvedValueOnce(true);

    const result = await processClaim('env2', 'player2', 1000);

    expect(result.success).toBe(true);
    expect(result.amountUnits).toBe(2007);
    expect(result.mineHit).toBe(true); // 2007 ends in 7
    expect(result.penaltyUnits).toBe(4014); // 2007 * 2
    expect(result.netChangeUnits).toBe(-4014);
  });

  it('should fail if the findOneAndUpdate returns null (race condition / empty / expired)', async () => {
    (RedEnvelopeModel.findOneAndUpdate as jest.Mock).mockResolvedValueOnce(null);
    
    (RedEnvelopeModel.findById as jest.Mock).mockReturnValueOnce({
      lean: jest.fn().mockResolvedValueOnce({
        state: 'ACTIVE',
        expiresAt: new Date(Date.now() + 10000),
        remainingPackets: 0,
        claims: []
      })
    }); // Simulate finding out why it failed

    const result = await processClaim('env3', 'player3', 1000);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('No packets remaining');
  });
});
