import { jackpotPoolOwner } from '../src/http/routes';

/**
 * A JACKPOT POOL BELONGS TO ITS TABLE, NOT TO ITS TIER.
 *
 * The owner is parsed out of the pool id, and it used to take the wrong segment — `split(':')[1]`
 * of `jp:mini:texas` is "mini". Every table's pools were therefore created owned by "mini", and
 * because `accounts` is uniquely indexed on (accountType, ownerId, scope), the SECOND table ever to
 * settle hit a duplicate-key error. That error escaped mid-settlement and left the room stuck in
 * IN_HAND with the hand unresolved — san-zhang and red-packet both wedged this way on a live table.
 *
 * So this is not a formatting detail: getting it wrong pools every table's jackpot into one owner
 * and then bricks every table after the first.
 */
describe('jackpotPoolOwner', () => {
  it('reads the table out of the id the game server actually sends', () => {
    // `tableJackpotAccounts` builds `jp:<tier>:<table>`.
    expect(jackpotPoolOwner('jp:mini:texas', 'round-1')).toBe('texas');
    expect(jackpotPoolOwner('jp:mini:niu-niu', 'round-1')).toBe('niu-niu');
    expect(jackpotPoolOwner('jp:grand:texas-cowboy', 'round-1')).toBe('texas-cowboy');
  });

  it('never returns a tier name as the owner', () => {
    for (const tier of ['mini', 'minor', 'major', 'grand']) {
      expect(jackpotPoolOwner(`jp:${tier}:san-zhang`, 'round-1')).toBe('san-zhang');
    }
  });

  it('gives different tables different owners, which is what stops the collision', () => {
    const a = jackpotPoolOwner('jp:mini:texas', 'r');
    const b = jackpotPoolOwner('jp:mini:san-zhang', 'r');
    expect(a).not.toBe(b);
  });

  it('also copes with the reverse ordering the old comment described', () => {
    expect(jackpotPoolOwner('jp:texas:mini', 'round-1')).toBe('texas');
  });

  it('falls back to the round id when the shape is not recognised', () => {
    expect(jackpotPoolOwner('', 'round-9')).toBe('round-9');
    expect(jackpotPoolOwner('nonsense', 'round-9')).toBe('round-9');
    expect(jackpotPoolOwner('jp:', 'round-9')).toBe('round-9');
    // Nothing but tiers in it — there is no table to find.
    expect(jackpotPoolOwner('jp:mini', 'round-9')).toBe('round-9');
  });
});
