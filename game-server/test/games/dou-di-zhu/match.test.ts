import {
  DouDiZhuMatch,
  IllegalMoveError,
  firstSeatLandlord,
} from '../../../src/games/dou-di-zhu/match';
import { build54Deck, cardRank, BIG_JOKER, SMALL_JOKER } from '../../../src/games/dou-di-zhu/ddz-deck';

/**
 * A whole game of Fight the Landlord, played through the engine the way a table would.
 *
 * The match is the authority: every assertion here is about it REFUSING something a caller should
 * not be able to do — playing out of turn, playing cards you do not hold, passing when the trick is
 * yours — or about the shape of the game itself: 17/17/17 and three in the middle, the landlord's
 * twenty, whose turn comes next, when a trick resets, who has won.
 */

/** A deterministic shuffle, so a test can name the exact hands it is talking about. */
const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const threePlayers = [
  { id: 'p1', name: 'You' },
  { id: 'p2', name: 'Mei' },
  { id: 'p3', name: 'Bruno' },
];

function match(options = {}): DouDiZhuMatch {
  return new DouDiZhuMatch(threePlayers, {
    randomFn: seeded(7),
    noBidFallback: firstSeatLandlord,
    ...options,
  });
}

/**
 * Bid the auction out, with `winner` taking it at 3.
 *
 * Asks the match who is on the clock rather than assuming p1→p2→p3: the auction goes round the
 * table in the table's own direction, so a clockwise room bids in a different order.
 */
function auction(m: DouDiZhuMatch, winner = 'p1'): void {
  for (let i = 0; i < 3; i++) {
    const bidder = m.getState().bidState.currentBidderId!;
    m.bid(bidder, bidder === winner ? 3 : 0);
  }
}

describe('the deck', () => {
  it('is 54 cards: 52 plus exactly two jokers', () => {
    const deck = build54Deck();
    expect(deck).toHaveLength(54);
    expect(new Set(deck).size).toBe(54);
    expect(deck.filter((c) => c === SMALL_JOKER || c === BIG_JOKER)).toHaveLength(2);
  });

  it('ranks 3 low through the two jokers', () => {
    expect(cardRank('3c')).toBe(3);
    expect(cardRank('Ah')).toBe(14);
    expect(cardRank('2s')).toBe(15);
    expect(cardRank(SMALL_JOKER)).toBe(16);
    expect(cardRank(BIG_JOKER)).toBe(17);
    expect(cardRank('2s')).toBeGreaterThan(cardRank('Ah'));
  });
});

describe('the deal', () => {
  it('gives everyone seventeen and leaves three in the middle', () => {
    const m = match();
    const state = m.getState();
    for (const p of state.players) expect(p.hand).toHaveLength(17);
    expect(state.bonusCards).toHaveLength(3);
    expect(state.bonusRevealed).toBe(false);

    const dealt = [...state.players.flatMap((p) => p.hand), ...state.bonusCards];
    expect(new Set(dealt).size).toBe(54);
  });

  it('hands the landlord the bonus cards, face up, for twenty', () => {
    const m = match();
    const bonus = m.getState().bonusCards;
    auction(m, 'p2');

    const state = m.getState();
    expect(state.landlordId).toBe('p2');
    expect(state.peasantIds.sort()).toEqual(['p1', 'p3']);
    expect(state.bonusRevealed).toBe(true);
    expect(m.handOf('p2')).toHaveLength(20);
    for (const card of bonus) expect(m.handOf('p2')).toContain(card);
    expect(m.handOf('p1')).toHaveLength(17);
  });
});

describe('bidding', () => {
  it('gives the chair to the highest bidder and lets them lead', () => {
    const m = match();
    m.bid('p1', 1);
    m.bid('p2', 3);
    m.bid('p3', 2);

    const state = m.getState();
    expect(state.landlordId).toBe('p2');
    expect(state.bidState.winningBid).toBe(3);
    expect(state.currentPlayerId).toBe('p2');
    expect(state.gameStatus).toBe('PLAYING');
  });

  it('falls back to the configured rule when nobody bids', () => {
    const m = match({ noBidFallback: firstSeatLandlord });
    m.bid('p1', 0);
    m.bid('p2', 0);
    m.bid('p3', 0);
    expect(m.getState().landlordId).toBe('p1');
    expect(m.getState().bidState.winningBid).toBe(1);

    // The default draws instead — same passes, a different chair.
    const drawn = new DouDiZhuMatch(threePlayers, {
      randomFn: seeded(7),
      noBidFallback: (ids) => ids[2]!,
    });
    for (const id of ['p1', 'p2', 'p3']) drawn.bid(id, 0);
    expect(drawn.getState().landlordId).toBe('p3');
  });

  it('refuses an out-of-turn bid and a nonsense one', () => {
    const m = match();
    expect(() => m.bid('p2', 3)).toThrow(/not your turn to bid/);
    expect(() => m.bid('p1', 7)).toThrow(/0 \(pass\) to 3/);
  });
});

describe('turn order', () => {
  it('runs counterclockwise by default', () => {
    const m = match();
    auction(m, 'p1');
    m.play('p1', [m.handOf('p1')[0]!]);
    expect(m.getState().currentPlayerId).toBe('p2');
  });

  it('can be turned round for a house that plays the other way', () => {
    const m = match({ turnDirection: 'CLOCKWISE' });
    auction(m, 'p1');
    m.play('p1', [m.handOf('p1')[0]!]);
    expect(m.getState().currentPlayerId).toBe('p3');
  });
});

describe('playing and passing', () => {
  it('refuses cards you do not hold, out-of-turn plays, and illegal shapes', () => {
    const m = match();
    auction(m, 'p1');

    expect(() => m.play('p2', [m.handOf('p2')[0]!])).toThrow(/not your turn/);

    const notMine = build54Deck().find((c) => !m.handOf('p1').includes(c))!;
    expect(() => m.play('p1', [notMine])).toThrow(IllegalMoveError);

    // Two cards of different ranks are not a pair.
    const hand = m.handOf('p1');
    const mismatched = hand.find((c) => cardRank(c) !== cardRank(hand[0]!))!;
    expect(() => m.play('p1', [hand[0]!, mismatched])).toThrow(/legal Dou Dizhu combination/);
  });

  it('will not let the trick leader pass', () => {
    const m = match();
    auction(m, 'p1');
    expect(() => m.pass('p1')).toThrow(/you lead this trick/);
  });

  it('clears the trick after both opponents pass, and the winner leads again', () => {
    const m = match();
    auction(m, 'p1');
    m.play('p1', [m.handOf('p1')[0]!]);
    m.pass('p2');

    expect(m.getState().passCount).toBe(1);
    expect(m.getState().lastCombination).not.toBeNull();

    m.pass('p3');
    const state = m.getState();
    expect(state.passCount).toBe(0);
    expect(state.lastCombination).toBeNull();
    expect(state.trickLeaderId).toBe('p1');
    expect(state.currentPlayerId).toBe('p1'); // leads the next trick
  });

  it('makes a follower beat the play, and lets the leader play anything next trick', () => {
    const m = match();
    auction(m, 'p1');
    const low = m.handOf('p1')[0]!;
    m.play('p1', [low]);

    const weaker = m.handOf('p2').find((c) => cardRank(c) < cardRank(low));
    if (weaker) {
      expect(() => m.play('p2', [weaker])).toThrow(/does not beat/);
    }
    const stronger = m.handOf('p2').find((c) => cardRank(c) > cardRank(low))!;
    m.play('p2', [stronger]);
    expect(m.getState().trickLeaderId).toBe('p2');
  });
});

describe('winning', () => {
  /** Play the match out with the dumbest legal line: lead the lowest card, otherwise pass. */
  function playToTheEnd(m: DouDiZhuMatch): void {
    for (let turn = 0; turn < 500 && m.status === 'PLAYING'; turn++) {
      const id = m.getState().currentPlayerId;
      const hand = m.handOf(id);
      const toBeat = m.mustBeat(id);
      if (!toBeat) {
        m.play(id, [hand[0]!]);
        continue;
      }
      const answer = hand.find((c) => cardRank(c) > toBeat.rank && toBeat.length === 1);
      if (answer && toBeat.type === 'single') m.play(id, [answer]);
      else m.pass(id);
    }
  }

  it('ends the moment a hand is empty, and says which side took it', () => {
    const m = match();
    auction(m, 'p1');
    playToTheEnd(m);

    const state = m.getState();
    expect(['LANDLORD_WON', 'PEASANTS_WON']).toContain(state.gameStatus);
    const empty = state.players.find((p) => p.hand.length === 0)!;
    expect(empty).toBeDefined();
    expect(state.gameStatus).toBe(empty.role === 'LANDLORD' ? 'LANDLORD_WON' : 'PEASANTS_WON');
    expect(m.winnerRole).toBe(empty.role);
  });

  it('refuses any further play once it is over', () => {
    const m = match();
    auction(m, 'p1');
    playToTheEnd(m);
    const id = m.getState().currentPlayerId;
    expect(() => m.play(id, m.handOf(id).slice(0, 1))).toThrow(/not in play/);
  });
});

describe('the engine owns the game', () => {
  it('hands out a copy, so nobody can deal themselves a better hand', () => {
    const m = match();
    const state = m.getState();
    state.players[0]!.hand.push(BIG_JOKER);
    state.gameStatus = 'LANDLORD_WON';

    expect(m.getState().players[0]!.hand).toHaveLength(17);
    expect(m.getState().gameStatus).toBe('BIDDING');
  });
});
