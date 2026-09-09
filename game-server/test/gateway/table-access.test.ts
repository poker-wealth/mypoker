import { TableAccess } from '../../src/gateway/table-access';

/**
 * The private-table policy itself, with no transport in front of it.
 *
 * The rail tests (`test/live/private-table-access.test.ts`) prove the guard is
 * actually consulted on a real socket. This file proves the guard says the
 * right thing — the two are separate on purpose, because TRAPS §23 is the story
 * of eighteen tests that all agreed about a rule while nothing enforced it on
 * the second transport.
 */
describe('TableAccess — who may reach a private table', () => {
  let access: TableAccess;

  beforeEach(() => {
    access = new TableAccess();
  });

  describe('public tables', () => {
    it('mints no code and lets anyone in', () => {
      expect(access.register('t-pub', 'public', 'creator')).toBeNull();
      expect(access.mayJoin('t-pub', 'creator')).toBe(true);
      expect(access.mayJoin('t-pub', 'a-stranger')).toBe(true);
    });

    it('has nothing to unlock, and says so rather than refusing', () => {
      access.register('t-pub', 'public', 'creator');
      expect(access.unlock('t-pub', 'a-stranger', '000000')).toBe('ok');
    });
  });

  describe('private tables', () => {
    it('mints a six-digit code and refuses everyone but the creator', () => {
      const code = access.register('t-priv', 'private', 'creator');
      expect(code).toMatch(/^\d{6}$/);

      // The creator was just shown the code, so they hold access by construction.
      expect(access.mayJoin('t-priv', 'creator')).toBe(true);
      expect(access.mayJoin('t-priv', 'a-stranger')).toBe(false);
    });

    it('admits a stranger who presents the code, and remembers them', () => {
      const code = access.register('t-priv', 'private', 'creator') as string;

      expect(access.mayJoin('t-priv', 'guest')).toBe(false);
      expect(access.unlock('t-priv', 'guest', code)).toBe('ok');
      expect(access.mayJoin('t-priv', 'guest')).toBe(true);

      // Remembered: they do not have to type it again on the next connection.
      expect(access.mayJoin('t-priv', 'guest')).toBe(true);
    });

    it('refuses a wrong code and does not admit on the attempt', () => {
      const code = access.register('t-priv', 'private', 'creator') as string;
      const wrong = code === '000000' ? '111111' : '000000';

      expect(access.unlock('t-priv', 'guest', wrong)).toBe('wrong-code');
      expect(access.mayJoin('t-priv', 'guest')).toBe(false);
    });

    it('unlocking one table does not unlock another', () => {
      const a = access.register('t-a', 'private', 'creator') as string;
      access.register('t-b', 'private', 'creator2');

      expect(access.unlock('t-a', 'guest', a)).toBe('ok');
      expect(access.mayJoin('t-a', 'guest')).toBe(true);
      expect(access.mayJoin('t-b', 'guest')).toBe(false);
    });
  });

  describe('brute force', () => {
    it('stops accepting guesses after the cap — and stays shut even for the right code', () => {
      const code = access.register('t-priv', 'private', 'creator') as string;
      const wrong = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < 10; i += 1) {
        expect(access.unlock('t-priv', 'guest', wrong)).toBe('wrong-code');
      }
      expect(access.unlock('t-priv', 'guest', wrong)).toBe('too-many-attempts');

      // The point of the cap: it must not be a speed bump that the correct
      // guess walks past. Someone who has burned the budget is done.
      expect(access.unlock('t-priv', 'guest', code)).toBe('too-many-attempts');
      expect(access.mayJoin('t-priv', 'guest')).toBe(false);
    });

    it('is counted per player, so one attacker cannot lock out the real guests', () => {
      const code = access.register('t-priv', 'private', 'creator') as string;
      const wrong = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < 11; i += 1) access.unlock('t-priv', 'attacker', wrong);
      expect(access.unlock('t-priv', 'attacker', code)).toBe('too-many-attempts');

      // A different player is unaffected.
      expect(access.unlock('t-priv', 'invited-guest', code)).toBe('ok');
      expect(access.mayJoin('t-priv', 'invited-guest')).toBe(true);
    });

    it('forgets a player’s failures once they get in', () => {
      const code = access.register('t-priv', 'private', 'creator') as string;
      const wrong = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < 9; i += 1) access.unlock('t-priv', 'guest', wrong);
      expect(access.unlock('t-priv', 'guest', code)).toBe('ok');

      // Budget reset — otherwise a fat-fingered guest is one typo from being
      // permanently locked out of a table they are allowed into.
      access.forget('t-priv');
      const code2 = access.register('t-priv', 'private', 'creator') as string;
      const wrong2 = code2 === '000000' ? '111111' : '000000';
      for (let i = 0; i < 10; i += 1) {
        expect(access.unlock('t-priv', 'guest', wrong2)).toBe('wrong-code');
      }
    });
  });

  describe('what it refuses to leak', () => {
    it('never returns the code to someone who does not already hold access', () => {
      access.register('t-priv', 'private', 'creator');

      expect(access.codeFor('t-priv', 'a-stranger')).toBeNull();
      expect(access.codeFor('t-priv', 'creator')).toMatch(/^\d{6}$/);
    });

    it('answers null for a table that does not exist, so it is not an id oracle', () => {
      expect(access.codeFor('t-does-not-exist', 'anyone')).toBeNull();
      expect(access.unlock('t-does-not-exist', 'anyone', '123456')).toBe('unknown-table');
    });
  });

  describe('tables it was never told about', () => {
    it('allows them — it is the authority for what it registered, not for everything', () => {
      // The fixed lobby tables and the league tables never register here; league
      // membership is checked by financial-core on its own path. If this
      // returned false the whole lobby would go dark.
      expect(access.mayJoin('texas', 'anyone')).toBe(true);
      expect(access.mayJoin('lg-abc-123', 'anyone')).toBe(true);
    });
  });

  describe('forget', () => {
    it('drops the record so a reused id does not inherit the old code', () => {
      const first = access.register('t-priv', 'private', 'creator') as string;
      access.forget('t-priv');

      // Gone entirely: not "public", not "still guarded by the old code".
      expect(access.codeFor('t-priv', 'creator')).toBeNull();
      expect(access.unlock('t-priv', 'creator', first)).toBe('unknown-table');
    });
  });
});
