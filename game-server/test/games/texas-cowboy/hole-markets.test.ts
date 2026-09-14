import { holeQualifies, DEFAULT_MARKETS } from '../../../src/games/texas-cowboy/engine';

/**
 * The "Either hand type" band, pinned.
 *
 * These three predicates decide real payouts at 1.66x, 8.5x and 100x. Each is a
 * one-line rule, and every one of them is easy to get quietly wrong in a way no
 * screen would show: a market that silently never pays looks exactly like a
 * market nobody happened to win.
 */

describe('holeQualifies — POCKET_PAIR', () => {
  it('is a pair of the same rank, whatever the suits', () => {
    expect(holeQualifies(['As', 'Ah'], 'POCKET_PAIR')).toBe(true);
    expect(holeQualifies(['7c', '7d'], 'POCKET_PAIR')).toBe(true);
  });

  it('is not two cards of the same SUIT', () => {
    // The classic confusion. Suited is a different market at different odds.
    expect(holeQualifies(['As', 'Ks'], 'POCKET_PAIR')).toBe(false);
  });
});

describe('holeQualifies — POCKET_ACES', () => {
  it('needs both cards to be aces', () => {
    expect(holeQualifies(['As', 'Ah'], 'POCKET_ACES')).toBe(true);
    expect(holeQualifies(['As', 'Kh'], 'POCKET_ACES')).toBe(false);
    expect(holeQualifies(['Ks', 'Kh'], 'POCKET_ACES')).toBe(false);
  });

  it('pays the 100x market only — a pair of aces is also a pocket pair', () => {
    // Both markets are real and both are settled, so aces qualify for both.
    // This is not double-paying one bet: they are two separate stakes.
    expect(holeQualifies(['As', 'Ah'], 'POCKET_PAIR')).toBe(true);
    expect(holeQualifies(['As', 'Ah'], 'POCKET_ACES')).toBe(true);
  });
});

describe('holeQualifies — SUITED_OR_CONNECTED', () => {
  it('takes suited alone', () => {
    expect(holeQualifies(['2s', '9s'], 'SUITED_OR_CONNECTED')).toBe(true);
  });

  it('takes connected alone', () => {
    expect(holeQualifies(['8c', '9d'], 'SUITED_OR_CONNECTED')).toBe(true);
    expect(holeQualifies(['Jh', 'Tc'], 'SUITED_OR_CONNECTED')).toBe(true);
  });

  it('counts the ace at BOTH ends — A-K and A-2 both connect', () => {
    // The wheel. Without it, one of the two ways an ace connects never pays,
    // and nobody would ever see that it did not.
    expect(holeQualifies(['Ac', 'Kd'], 'SUITED_OR_CONNECTED')).toBe(true);
    expect(holeQualifies(['Ac', '2d'], 'SUITED_OR_CONNECTED')).toBe(true);
  });

  it('refuses a gap of two, in either direction', () => {
    expect(holeQualifies(['8c', 'Td'], 'SUITED_OR_CONNECTED')).toBe(false);
    expect(holeQualifies(['Td', '8c'], 'SUITED_OR_CONNECTED')).toBe(false);
  });

  it('does NOT treat K-2 as connected — only the ace wraps', () => {
    expect(holeQualifies(['Kc', '2d'], 'SUITED_OR_CONNECTED')).toBe(false);
  });

  it('refuses a hand it has not been dealt', () => {
    expect(holeQualifies([], 'SUITED_OR_CONNECTED')).toBe(false);
    expect(holeQualifies(['As'], 'SUITED_OR_CONNECTED')).toBe(false);
  });
});

describe('the reference board', () => {
  it('sells the eleven markets the reference does, at its prices', () => {
    // The prices are the reference's, not ours to invent. If one moves, it
    // moves here deliberately and this test is the conversation.
    const priced = Object.fromEntries(DEFAULT_MARKETS.map((m) => [m.id, m.multiplier]));
    expect(priced).toEqual({
      cowboy_win: 2.02,
      tie: 19.5,
      cowgirl_win: 2.02,
      suited_connects: 1.66,
      pocket_pair: 8.5,
      pocket_aces: 100,
      high_card_or_pair: 2.2,
      two_pair: 3.1,
      trips_straight_flush: 4.5,
      full_house: 20,
      quads_or_better: 248,
    });
  });

  it('groups the hand types the way the price assumes', () => {
    // 4.5x is the price of "three of a kind OR straight OR flush". Pricing one
    // member of that group at the group's odds is a different bet, and that is
    // exactly what this board used to do.
    const group = DEFAULT_MARKETS.find((m) => m.id === 'trips_straight_flush');
    expect(group?.selections).toEqual(['THREE_OF_A_KIND', 'STRAIGHT', 'FLUSH']);

    const long = DEFAULT_MARKETS.find((m) => m.id === 'quads_or_better');
    expect(long?.selections).toEqual(['FOUR_OF_A_KIND', 'STRAIGHT_FLUSH', 'ROYAL_FLUSH']);

    const short = DEFAULT_MARKETS.find((m) => m.id === 'high_card_or_pair');
    expect(short?.selections).toEqual(['HIGH_CARD', 'ONE_PAIR']);
  });
});
