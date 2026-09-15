import type { HandRecord, SeatHandRecord } from '../../src/history/hand-record';
import { handViewFor } from '../../src/history/hand-view';

/**
 * What a player may see of a recorded hand.
 *
 * The record holds every seat's hole cards. These tests pin the one rule that
 * keeps the hand-history panel from being a way to read what opponents folded.
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

function hand(seats: SeatHandRecord[], over: Partial<HandRecord> = {}): HandRecord {
  return {
    roundId: 'r1',
    tableId: 't1',
    gameId: 'texas',
    handNumber: 7,
    playedAt: new Date('2026-09-15T12:00:00Z'),
    bigBlind: 2,
    community: ['2h', '7c', 'Td'],
    seats,
    actions: [],
    ...over,
  };
}

describe('handViewFor — what one player may see of a hand', () => {
  it('always shows the viewer their own cards, even when they folded', () => {
    const view = handViewFor(
      hand([seat({ playerId: 'me', holeCards: ['Qs', 'Qh'] }), seat({ playerId: 'them' })]),
      'me',
    );
    const me = view.seats.find((s) => s.playerId === 'me')!;
    expect(me.isYou).toBe(true);
    expect(me.holeCards).toEqual(['Qs', 'Qh']);
  });

  it("never shows an opponent's folded cards", () => {
    const view = handViewFor(
      hand([seat({ playerId: 'me' }), seat({ playerId: 'folder', holeCards: ['9s', '9d'] })]),
      'me',
    );
    expect(view.seats.find((s) => s.playerId === 'folder')!.holeCards).toBeNull();
  });

  it('shows the cards of everyone who went to a real showdown', () => {
    const view = handViewFor(
      hand([
        seat({ playerId: 'me', sawShowdown: true }),
        seat({ playerId: 'rival', holeCards: ['Jc', 'Jd'], sawShowdown: true, wonAtShowdown: true }),
        seat({ playerId: 'folder', holeCards: ['2c', '3d'] }),
      ]),
      'me',
    );
    expect(view.seats.find((s) => s.playerId === 'rival')!.holeCards).toEqual(['Jc', 'Jd']);
    expect(view.seats.find((s) => s.playerId === 'folder')!.holeCards).toBeNull();
  });

  it('hides the winner of an uncontested pot — they never showed', () => {
    const view = handViewFor(
      hand([
        seat({ playerId: 'me' }),
        seat({ playerId: 'winner', holeCards: ['7h', '2s'], sawShowdown: true, wonAtShowdown: true }),
      ]),
      'me',
    );
    expect(view.seats.find((s) => s.playerId === 'winner')!.holeCards).toBeNull();
  });

  it('carries the hand number, board, time and each net unchanged', () => {
    const view = handViewFor(
      hand([seat({ playerId: 'me', net: 14 }), seat({ playerId: 'them', net: -14 })]),
      'me',
    );
    expect(view.handNumber).toBe(7);
    expect(view.community).toEqual(['2h', '7c', 'Td']);
    expect(view.playedAt).toBe('2026-09-15T12:00:00.000Z');
    expect(view.seats.map((s) => s.net)).toEqual([14, -14]);
  });
});
