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

  describe('game PIN — the lobby join', () => {
    const other = (pin: string): string => (pin === '000000' ? '111111' : '000000');

    it("gives every table a six-digit PIN, and a private table's PIN is its code", () => {
      const code = access.register('t-priv', 'private', 'creator') as string;
      access.register('t-pub', 'public', 'creator');

      expect(access.pinFor('t-priv', 'creator')).toBe(code);
      expect(access.pinFor('t-pub', 'anyone')).toMatch(/^\d{6}$/);
    });

    it('never hands a private PIN to someone outside the table', () => {
      access.register('t-priv', 'private', 'creator');

      expect(access.pinFor('t-priv', 'a-stranger')).toBeNull();
      expect(access.pinFor('t-does-not-exist', 'anyone')).toBeNull();
    });

    it('finds a public table', () => {
      access.register('t-pub', 'public', 'creator');
      const pin = access.pinFor('t-pub', 'guest') as string;

      expect(access.redeemPin('guest', pin)).toEqual({ result: 'ok', tableId: 't-pub' });
    });

    it('finds a private table AND lets the player in — the PIN is the code', () => {
      const code = access.register('t-priv', 'private', 'creator') as string;
      expect(access.mayJoin('t-priv', 'guest')).toBe(false);

      expect(access.redeemPin('guest', code)).toEqual({ result: 'ok', tableId: 't-priv' });
      expect(access.mayJoin('t-priv', 'guest')).toBe(true);
    });

    it('keeps PINs unique across tables, even where random draws collide', () => {
      // 2,000 draws from a million collide more often than not; every PIN must still be distinct.
      const pins = new Set<string>();
      for (let i = 0; i < 2_000; i += 1) {
        access.register(`t-${i}`, i % 2 === 0 ? 'public' : 'private', 'creator');
        pins.add(access.pinFor(`t-${i}`, 'creator') as string);
      }
      expect(pins.size).toBe(2_000);
    });

    it('answers not-found for a PIN that matches nothing', () => {
      expect(access.redeemPin('guest', '123456')).toEqual({ result: 'not-found' });
    });

    it('caps wrong PINs per player across every table — and the cap holds for the right PIN', () => {
      const code = access.register('t-priv', 'private', 'creator') as string;

      for (let i = 0; i < 10; i += 1) {
        expect(access.redeemPin('attacker', other(code))).toEqual({ result: 'not-found' });
      }
      expect(access.redeemPin('attacker', code)).toEqual({ result: 'too-many-attempts' });
      expect(access.mayJoin('t-priv', 'attacker')).toBe(false);

      // Counted per player: the invited guest is unaffected.
      expect(access.redeemPin('guest', code)).toEqual({ result: 'ok', tableId: 't-priv' });
    });

    it('lets a shut-out player try again once the window has passed', () => {
      let now = 1_000_000;
      const timed = new TableAccess(() => now);
      const code = timed.register('t-priv', 'private', 'creator') as string;

      for (let i = 0; i < 10; i += 1) timed.redeemPin('guest', other(code));
      expect(timed.redeemPin('guest', code)).toEqual({ result: 'too-many-attempts' });

      now += 10 * 60_000;
      expect(timed.redeemPin('guest', code)).toEqual({ result: 'ok', tableId: 't-priv' });
    });

    it('does not refill the budget on a success, so owning a table buys no extra guesses', () => {
      access.register('t-mine', 'public', 'attacker');
      const mine = access.pinFor('t-mine', 'attacker') as string;

      for (let i = 0; i < 9; i += 1) access.redeemPin('attacker', other(mine));
      expect(access.redeemPin('attacker', mine)).toEqual({ result: 'ok', tableId: 't-mine' });
      expect(access.redeemPin('attacker', other(mine))).toEqual({ result: 'not-found' });
      expect(access.redeemPin('attacker', mine)).toEqual({ result: 'too-many-attempts' });
    });

    it("refuses a player who already spent that table's own unlock budget", () => {
      const code = access.register('t-priv', 'private', 'creator') as string;
      for (let i = 0; i < 10; i += 1) access.unlock('t-priv', 'guest', other(code));

      expect(access.redeemPin('guest', code)).toEqual({ result: 'too-many-attempts' });
      expect(access.mayJoin('t-priv', 'guest')).toBe(false);
    });

    it('forgets the PIN with the table', () => {
      const code = access.register('t-priv', 'private', 'creator') as string;
      access.forget('t-priv');

      expect(access.redeemPin('guest', code)).toEqual({ result: 'not-found' });
    });
  });
});
