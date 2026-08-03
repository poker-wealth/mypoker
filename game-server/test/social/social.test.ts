import {
  spectatorView,
  spectatorMayAct,
  maySpectate,
  type TableSnapshot,
} from '../../src/social/spectator';
import {
  evaluateChat,
  recordMessage,
  mute,
  newChatterState,
  muteAffectsFunds,
  MAX_MESSAGE_LENGTH,
} from '../../src/social/chat';

const T0 = Date.UTC(2026, 6, 16, 12, 0, 0);

const snapshot: TableSnapshot = {
  tableId: 't1',
  phase: 'FLOP',
  community: ['Ah', 'Kd', '7c'],
  pot: 300,
  seats: [
    { playerId: 'alice', stack: 900, folded: false },
    { playerId: 'bob', stack: 800, folded: false },
  ],
  holeCards: { alice: ['As', 'Ks'], bob: ['2c', '3d'] }, // PRIVATE
  serverSeed: 'secret-seed-not-yet-revealed', // PRIVATE
};

describe('spectator — never sees private information', () => {
  it('hole cards are absent from a spectator’s view', () => {
    const view = spectatorView(snapshot);
    expect(view).not.toHaveProperty('holeCards');
    expect(JSON.stringify(view)).not.toContain('As'); // alice's card appears nowhere
    expect(JSON.stringify(view)).not.toContain('2c');
  });

  it('the unrevealed server seed is absent — no early peek at the deal', () => {
    const view = spectatorView(snapshot);
    expect(view).not.toHaveProperty('serverSeed');
    expect(JSON.stringify(view)).not.toContain('secret-seed');
  });

  it('a new private field cannot leak by being forgotten — redaction, not assembly', () => {
    // Someone adds a private field to the snapshot later and forgets the spectator path.
    const withNewSecret = { ...snapshot, holeCards: { alice: ['Qh', 'Qs'] } };
    const view = spectatorView(withNewSecret);
    expect(JSON.stringify(view)).not.toContain('Qh');
  });

  it('public state IS visible — that’s the point of watching', () => {
    const view = spectatorView(snapshot);
    expect(view.community).toEqual(['Ah', 'Kd', '7c']);
    expect(view.pot).toBe(300);
    expect(view.seats).toHaveLength(2);
    expect(view.spectating).toBe(true);
  });

  it('a spectator can never act', () => {
    expect(spectatorMayAct()).toBe(false);
  });
});

describe('spectator — access policy', () => {
  it('a league may switch spectating off', () => {
    expect(maySpectate({ spectatorsAllowed: false, seatedPlayerIds: [] }, 'v')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/disabled/),
    });
  });

  it('a seated player is a player, not a spectator', () => {
    expect(maySpectate({ spectatorsAllowed: true, seatedPlayerIds: ['alice'] }, 'alice')).toMatchObject({
      ok: false,
    });
    expect(maySpectate({ spectatorsAllowed: true, seatedPlayerIds: ['alice'] }, 'carol').ok).toBe(true);
  });
});

describe('chat — reputation gates chat, never money', () => {
  const base = { isSpectator: false, message: 'nice hand', now: T0 };

  it('an Average+ player may chat', () => {
    expect(evaluateChat(newChatterState(), { ...base, reputationScore: 500 }).ok).toBe(true);
  });

  it('a Very Poor player cannot chat — but their funds are untouched', () => {
    expect(evaluateChat(newChatterState(), { ...base, reputationScore: 100 })).toEqual({
      ok: false,
      reason: 'REPUTATION_TOO_LOW',
    });
    expect(muteAffectsFunds()).toBe(false); // the penalty never reaches the money
  });

  it('a mute silences chat only, and expires', () => {
    const s = newChatterState();
    mute(s, T0 + 60_000);
    expect(evaluateChat(s, { ...base, reputationScore: 900 })).toEqual({ ok: false, reason: 'MUTED' });
    // After it expires, an Excellent player chats again.
    expect(evaluateChat(s, { ...base, reputationScore: 900, now: T0 + 61_000 }).ok).toBe(true);
    expect(muteAffectsFunds()).toBe(false);
  });
});

describe('chat — flood protection', () => {
  it('rate-limits after 5 messages in 10 seconds, then recovers', () => {
    const s = newChatterState();
    for (let i = 0; i < 5; i++) {
      expect(evaluateChat(s, { isSpectator: false, message: 'hi', now: T0 + i, reputationScore: 700 }).ok).toBe(true);
      recordMessage(s, T0 + i);
    }
    expect(evaluateChat(s, { isSpectator: false, message: 'hi', now: T0 + 6, reputationScore: 700 })).toEqual({
      ok: false,
      reason: 'RATE_LIMITED',
    });
    // The window slides — 11 seconds later they can talk again.
    expect(
      evaluateChat(s, { isSpectator: false, message: 'hi', now: T0 + 11_000, reputationScore: 700 }).ok,
    ).toBe(true);
  });

  it('rejects empty and over-long messages', () => {
    const s = newChatterState();
    expect(evaluateChat(s, { isSpectator: false, message: '   ', now: T0, reputationScore: 700 })).toEqual({
      ok: false,
      reason: 'EMPTY',
    });
    expect(
      evaluateChat(s, {
        isSpectator: false,
        message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1),
        now: T0,
        reputationScore: 700,
      }),
    ).toEqual({ ok: false, reason: 'TOO_LONG' });
  });
});

describe('chat — spectators cannot narrate a live hand', () => {
  it('a spectator is refused, however good their reputation', () => {
    expect(
      evaluateChat(newChatterState(), {
        isSpectator: true,
        message: 'he has aces',
        now: T0,
        reputationScore: 1000,
      }),
    ).toEqual({ ok: false, reason: 'SPECTATORS_CANNOT_CHAT' });
  });
});
