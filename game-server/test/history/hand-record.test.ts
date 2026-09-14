import {
  deriveStats,
  netByPosition,
  positionOf,
  type HandRecord,
  type RecordedAction,
  type SeatHandRecord,
} from '../../src/history/hand-record';

/**
 * The statistic definitions, pinned.
 *
 * These are the numbers the Data page's radar plots, and every one of them is
 * easy to get subtly wrong in a way nobody can see once it is a shape on a
 * chart. A wrong denominator does not throw; it just quietly says a player is
 * someone they are not.
 */

function seat(over: Partial<SeatHandRecord> & { playerId: string }): SeatHandRecord {
  return {
    seatIndex: 0,
    position: 'BTN',
    holeCards: ['As', 'Kd'],
    invested: 0,
    net: 0,
    sawShowdown: false,
    wonAtShowdown: false,
    ...over,
  };
}

function hand(over: Partial<HandRecord> & { seats: SeatHandRecord[] }): HandRecord {
  return {
    roundId: 'r1',
    tableId: 't1',
    gameId: 'texas',
    handNumber: 1,
    playedAt: new Date('2026-09-14T00:00:00Z'),
    bigBlind: 2,
    community: [],
    actions: [],
    ...over,
  };
}

const raise = (playerId: string, amount = 6): RecordedAction => ({
  playerId,
  street: 'PREFLOP',
  type: 'raise',
  amount,
});
const call = (playerId: string, amount = 2): RecordedAction => ({
  playerId,
  street: 'PREFLOP',
  type: 'call',
  amount,
});

describe('positionOf', () => {
  it('names the button and both blinds', () => {
    expect(positionOf(0, 6)).toBe('BTN');
    expect(positionOf(1, 6)).toBe('SB');
    expect(positionOf(2, 6)).toBe('BB');
  });

  it('calls the seat before the button the cutoff', () => {
    expect(positionOf(5, 6)).toBe('CO');
    expect(positionOf(8, 9)).toBe('CO');
  });

  it('treats heads-up as button and big blind, with no small blind seat of its own', () => {
    // The button IS the small blind heads-up. Reporting 'SB' for one of them
    // and 'BTN' for the other would put the same seat in two rows.
    expect(positionOf(0, 2)).toBe('BTN');
    expect(positionOf(1, 2)).toBe('BB');
  });

  it('bands the middle seats rather than naming them', () => {
    expect(positionOf(3, 9)).toBe('UTG');
    expect(positionOf(4, 9)).toBe('MP');
    expect(positionOf(6, 9)).toBe('MP');
  });
});

describe('deriveStats', () => {
  it('reports nothing rather than zero when a player has no hands', () => {
    const stats = deriveStats([], 'p1');
    expect(stats.hands).toBe(0);
    // Null, not 0 — "never played" and "played and never entered a pot" are
    // different facts and must not render the same.
    expect(stats.vpip).toBeNull();
    expect(stats.pfr).toBeNull();
    expect(stats.wssd).toBeNull();
  });

  it('does NOT count a posted blind as voluntary', () => {
    // The big blind checks to a flop. They put money in, but not by choice, so
    // VPIP is zero — this is the single most common way to get VPIP wrong.
    const h = hand({
      seats: [seat({ playerId: 'p1', position: 'BB', invested: 2 })],
      actions: [{ playerId: 'p1', street: 'PREFLOP', type: 'check', amount: 0 }],
    });
    expect(deriveStats([h], 'p1').vpip).toBe(0);
  });

  it('counts a preflop call as voluntary and a raise as both VPIP and PFR', () => {
    const called = hand({ seats: [seat({ playerId: 'p1' })], actions: [call('p1')] });
    expect(deriveStats([called], 'p1').vpip).toBe(100);
    expect(deriveStats([called], 'p1').pfr).toBe(0);

    const raised = hand({ seats: [seat({ playerId: 'p1' })], actions: [raise('p1')] });
    expect(deriveStats([raised], 'p1').vpip).toBe(100);
    expect(deriveStats([raised], 'p1').pfr).toBe(100);
  });

  it('counts PFR once per hand, however many times the player raised', () => {
    const h = hand({
      seats: [seat({ playerId: 'p1' })],
      actions: [raise('p1'), raise('p2'), raise('p1')],
    });
    // Two raises, one hand raised.
    expect(deriveStats([h], 'p1').pfr).toBe(100);
  });

  it('calls the THIRD preflop bet a 3-bet, and not the second or the fourth', () => {
    // p2 opens (2-bet), p1 re-raises (3-bet).
    const threeBet = hand({
      seats: [seat({ playerId: 'p1' })],
      actions: [raise('p2'), raise('p1')],
    });
    expect(deriveStats([threeBet], 'p1').threeBet).toBe(100);

    // p1 opens. That is the 2-bet, not a 3-bet.
    const opened = hand({ seats: [seat({ playerId: 'p1' })], actions: [raise('p1')] });
    expect(deriveStats([opened], 'p1').threeBet).toBe(0);

    // p2 opens, p3 3-bets, p1 4-bets. A 4-bet is not a 3-bet.
    const fourBet = hand({
      seats: [seat({ playerId: 'p1' })],
      actions: [raise('p2'), raise('p3'), raise('p1')],
    });
    expect(deriveStats([fourBet], 'p1').threeBet).toBe(0);
  });

  it('divides WTSD by hands and W$SD by showdowns — not both by hands', () => {
    // Four hands, one showdown, and that showdown was won. WTSD is 25% of
    // hands; W$SD is 100% of showdowns. Sharing a denominator would report 25%
    // for both and make a player who wins every showdown look like they lose
    // three out of four.
    const records = [
      hand({ seats: [seat({ playerId: 'p1', sawShowdown: true, wonAtShowdown: true })] }),
      hand({ seats: [seat({ playerId: 'p1' })] }),
      hand({ seats: [seat({ playerId: 'p1' })] }),
      hand({ seats: [seat({ playerId: 'p1' })] }),
    ];
    const stats = deriveStats(records, 'p1');
    expect(stats.wtsd).toBe(25);
    expect(stats.wssd).toBe(100);
  });

  it('has no aggression factor for a player who has never called', () => {
    // raises / calls with no calls is not infinity, it is unanswerable.
    const h = hand({ seats: [seat({ playerId: 'p1' })], actions: [raise('p1')] });
    expect(deriveStats([h], 'p1').aggression).toBeNull();
  });

  it('computes aggression as raises over calls across every street', () => {
    const h = hand({
      seats: [seat({ playerId: 'p1' })],
      actions: [
        raise('p1'),
        { playerId: 'p1', street: 'FLOP', type: 'raise', amount: 10 },
        { playerId: 'p1', street: 'TURN', type: 'call', amount: 10 },
      ],
    });
    expect(deriveStats([h], 'p1').aggression).toBe(2);
  });

  it('measures BB/100 in big blinds, so tables of different stakes compare', () => {
    // +20 chips at 1/2 is +10bb. +20 chips at 5/10 is +2bb. Averaged over two
    // hands that is 6bb a hand, 600 per 100 — a figure only meaningful because
    // it is not in chips.
    const records = [
      hand({ bigBlind: 2, seats: [seat({ playerId: 'p1', net: 20 })] }),
      hand({ bigBlind: 10, seats: [seat({ playerId: 'p1', net: 20 })] }),
    ];
    expect(deriveStats(records, 'p1').bb100).toBe(600);
  });

  it('ignores hands the player was not in', () => {
    const records = [
      hand({ seats: [seat({ playerId: 'p1' })], actions: [raise('p1')] }),
      hand({ seats: [seat({ playerId: 'p2' })], actions: [raise('p2')] }),
    ];
    expect(deriveStats(records, 'p1').hands).toBe(1);
  });
});

describe('netByPosition', () => {
  it('reports null for a position never played, not zero', () => {
    const records = [hand({ seats: [seat({ playerId: 'p1', position: 'BTN', net: 20 })] })];
    const byPosition = netByPosition(records, 'p1');
    expect(byPosition.BTN).toBe(10); // +20 chips at bb 2
    // Never sat there — "0.0" would read as having broken even from the cutoff.
    expect(byPosition.CO).toBeNull();
  });

  it('sums a position across hands in big blinds', () => {
    const records = [
      hand({ bigBlind: 2, seats: [seat({ playerId: 'p1', position: 'BTN', net: 20 })] }),
      hand({ bigBlind: 10, seats: [seat({ playerId: 'p1', position: 'BTN', net: -20 })] }),
    ];
    // +10bb then −2bb.
    expect(netByPosition(records, 'p1').BTN).toBe(8);
  });
});
