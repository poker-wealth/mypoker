import { describe, it, expect } from 'vitest';
import {
  TABLE_DESIGNS,
  designForGame,
  designById,
  DEFAULT_DESIGN_ID,
  ringFor,
  seatCapFor,
} from './tableDesigns';

/**
 * The seat ceiling is a property of the ARTWORK, and this ties the number to it.
 *
 * Three things used to answer "how many chairs may a table have" and they
 * disagreed: the lobby catalogue said nine for Hold'em, Short Deck and Omaha
 * alike; the live rooms actually seated six, eight and six; and league creation
 * accepted anything from two to nine for any variant. A nine-seat Hold'em table
 * was accepted by every layer and only went wrong on screen.
 *
 * It goes wrong because each design places seats per count and then stops — the
 * portrait stadium felt at six, the wide landscape felt at eight. Ask `ringFor`
 * for a count it has no ring for and it falls back to an evenly-spaced circle,
 * which on an oval felt seats people in the middle of the table rather than on
 * the rail. Nothing throws. It just looks broken.
 *
 * `seatCapFor` now derives the ceiling from the rings, so the two cannot drift
 * here. What CAN still drift is this side against the server's
 * `PokerVariant.maxSeats`, which is a separate copy in a separate package — so
 * the numbers are pinned below rather than merely derived. If new artwork moves
 * one, this test fails and whoever moved it has to go and move the server too.
 */

const POKER = ['texas', 'short-deck', 'omaha'] as const;

describe('the caps the artwork actually supports', () => {
  /**
   * Concrete numbers on purpose. Asserting `seatCapFor` against the rings it is
   * computed from would be circular and always pass; these are the values the
   * server must agree with.
   */
  it.each([
    ['texas', 8],
    ['short-deck', 8],
    ['omaha', 8],
  ] as const)('%s caps at %i — the server copy must match', (game, expected) => {
    expect(seatCapFor(game)).toBe(expected);
  });

  /**
   * The client's requirement: a table can be created for anything from two to
   * eight players, so EVERY felt has to place every one of those counts. It is
   * not enough that a ring exists — it has to hold the right number of DISTINCT
   * positions, or two players sit on top of each other.
   */
  it.each(TABLE_DESIGNS.map((d) => d.id))('%s places 2 through 8 distinctly', (id) => {
    const design = designById(id);
    for (let n = 2; n <= 8; n++) {
      const ring = design.rings[n];
      expect({ seats: n, hasRing: Boolean(ring) }).toEqual({ seats: n, hasRing: true });
      expect(ring!).toHaveLength(n);
      // Distinct: a duplicated coordinate stacks two players in one chair.
      expect(new Set(ring!.map((s) => `${s.left}/${s.top}`)).size).toBe(n);
    }
  });

  it('the hero is always bottom-centre, on every felt and every size', () => {
    // Seat 0 is the viewer. If it drifts, the table rotates under the player.
    for (const design of TABLE_DESIGNS) {
      for (let n = 2; n <= 8; n++) {
        const hero = design.rings[n]![0]!;
        expect({ design: design.id, seats: n, align: hero.align }).toEqual({
          design: design.id,
          seats: n,
          align: 'bottom',
        });
      }
    }
  });

  it('a count above the cap falls back to the generic circle — the failure being guarded', () => {
    const wide = designForGame('short-deck', undefined, designById(DEFAULT_DESIGN_ID));
    const over = seatCapFor('short-deck') + 1;
    // It still returns something, which is exactly why this was invisible: no
    // error, just seats computed on a circle instead of placed on the rail.
    expect(ringFor(wide!, over)).toHaveLength(over);
    expect(wide!.rings[over]).toBeUndefined();
  });

  it('every design starts at two — one player is not a table', () => {
    for (const design of TABLE_DESIGNS) {
      const counts = Object.keys(design.rings).map(Number);
      expect({ design: design.id, min: Math.min(...counts) }).toEqual({
        design: design.id,
        min: 2,
      });
    }
  });

  it('every poker game resolves to a cap that is a real number', () => {
    for (const game of POKER) {
      const cap = seatCapFor(game);
      expect(Number.isFinite(cap)).toBe(true);
      expect(cap).toBeGreaterThanOrEqual(2);
    }
  });
});
