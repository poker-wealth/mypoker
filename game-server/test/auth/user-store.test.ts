import { userStore } from '../../src/auth/user-store';
import { UserModel } from '../../src/auth/user.model';

// findOrCreateGoogle talks to UserModel directly; mock it the same way
// claimProcessor.test.ts mocks its Mongoose model, so no real connection is
// needed for this test.
jest.mock('../../src/auth/user.model', () => ({
  UserModel: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
  },
}));

function leaned<T>(value: T): { lean: () => Promise<T> } {
  return { lean: () => Promise.resolve(value) };
}

describe('userStore.oauth / findOrCreateGoogle', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('links a Google identity to an existing account when the email is verified', async () => {
    (UserModel.findOne as jest.Mock).mockImplementation((query: Record<string, unknown>) => {
      if ('googleId' in query) return leaned(null);
      // findByIdentifier's $or lookup
      return leaned({ _id: 'player-existing', email: 'existing@example.com' });
    });
    (UserModel.findOneAndUpdate as jest.Mock).mockReturnValue(
      leaned({ _id: 'player-existing', email: 'existing@example.com', googleId: 'g-1' }),
    );

    const identity = await userStore.oauth('g-1', 'existing@example.com', true, 'Existing');

    expect(identity.playerId).toBe('player-existing');
    expect(UserModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'player-existing' },
      { $set: { googleId: 'g-1', photoUrl: undefined } },
      { new: true },
    );
  });

  it('refuses to adopt an existing account when the email is NOT verified (the takeover this guards against)', async () => {
    (UserModel.findOne as jest.Mock).mockImplementation((query: Record<string, unknown>) => {
      if ('googleId' in query) return leaned(null);
      return leaned({ _id: 'player-victim', email: 'victim@example.com' });
    });

    await expect(userStore.oauth('attacker-google-id', 'victim@example.com', false, 'Attacker')).rejects.toThrow(
      'This email is registered. Sign in with your password, or verify your email with Google first.',
    );

    expect(UserModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('still creates a brand-new account for an unverified email with no existing match', async () => {
    (UserModel.findOne as jest.Mock).mockImplementation(() => leaned(null));
    (UserModel.create as jest.Mock).mockResolvedValue({
      toObject: () => ({ _id: 'player-new', email: 'brandnew@example.com', googleId: 'g-2' }),
    });

    const identity = await userStore.oauth('g-2', 'brandnew@example.com', false, 'Brand New');

    expect(identity.playerId).toBe('player-new');
    expect(UserModel.create).toHaveBeenCalled();
  });

  it('returns the existing Google-linked account without touching email lookup at all', async () => {
    (UserModel.findOne as jest.Mock).mockImplementation((query: Record<string, unknown>) => {
      if ('googleId' in query) return leaned({ _id: 'player-existing-google', googleId: 'g-3' });
      throw new Error('should not look up by email once googleId already matches');
    });

    const identity = await userStore.oauth('g-3', 'whatever@example.com', false);

    expect(identity.playerId).toBe('player-existing-google');
  });
});
