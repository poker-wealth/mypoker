import {
  serializeSnapshot,
  deserializeSnapshot,
  isNewerSnapshot,
  TableMigrationError,
  TABLE_SNAPSHOT_VERSION,
  type TableSnapshot,
} from '../../src/cluster/table-migration';

/** A realistic full table mid-hand: max seats + a chunky in-flight hand blob. */
function sampleSnapshot(): TableSnapshot {
  return {
    version: TABLE_SNAPSHOT_VERSION,
    tableId: 'sg-table-42',
    gameId: 'texas',
    config: { smallBlind: 10, bigBlind: 20, maxSeats: 9, rake: { bps: 500, cap: 100_000 } },
    seats: Array.from({ length: 9 }, (_, i) => ({
      index: i,
      playerId: `player-${i}`,
      name: `Player ${i}`,
      stack: 1000 + i * 25,
      sittingOut: i % 4 === 0,
    })),
    handState: {
      phase: 'FLOP',
      board: ['As', 'Kd', '7c'],
      pot: 340,
      toAct: 'player-3',
      deck: Array.from({ length: 40 }, (_, i) => `card-${i}`),
      bets: { 'player-1': 20, 'player-2': 40 },
    },
    seq: 7,
    capturedAt: 1_723_700_000_000,
  };
}

describe('table migration — snapshot codec', () => {
  it('round-trips a full mid-hand table losslessly', () => {
    const snap = sampleSnapshot();
    const restored = deserializeSnapshot(serializeSnapshot(snap));
    expect(restored).toEqual(snap); // seats, stacks, and the in-flight hand all survive
  });

  it('stays far inside the 500ms migration budget (codec is a small fraction of it)', () => {
    const snap = sampleSnapshot();
    // Measure the serialize+restore round-trip — the in-process part of a migration. It must leave
    // the vast majority of the 500ms budget for the inter-node transfer.
    const ITER = 200;
    const start = performance.now();
    for (let i = 0; i < ITER; i++) deserializeSnapshot(serializeSnapshot(snap));
    const perRoundTrip = (performance.now() - start) / ITER;
    expect(perRoundTrip).toBeLessThan(50); // one codec round-trip: milliseconds, vs a 500ms budget
  });

  it('rejects a garbled blob rather than restoring a corrupt table', () => {
    expect(() => deserializeSnapshot('{not json')).toThrow(TableMigrationError);
    expect(() => deserializeSnapshot('42')).toThrow(TableMigrationError);
  });

  it('rejects an unknown snapshot version (forward-incompatible node)', () => {
    const bad = JSON.stringify({ ...sampleSnapshot(), version: 999 });
    expect(() => deserializeSnapshot(bad)).toThrow(/version/);
  });

  it('rejects a snapshot with a malformed seat', () => {
    const snap = sampleSnapshot();
    const bad = JSON.stringify({
      ...snap,
      seats: [...snap.seats, { index: 9, playerId: 'x', name: 'y', stack: 'lots', sittingOut: false }],
    });
    expect(() => deserializeSnapshot(bad)).toThrow(/seat/);
  });

  it('accepts only strictly-newer snapshots at the destination (no rollback on redelivery)', () => {
    expect(isNewerSnapshot(sampleSnapshot(), undefined)).toBe(true); // first arrival
    expect(isNewerSnapshot(sampleSnapshot(), 6)).toBe(true); // seq 7 > 6
    expect(isNewerSnapshot(sampleSnapshot(), 7)).toBe(false); // duplicate delivery
    expect(isNewerSnapshot(sampleSnapshot(), 8)).toBe(false); // stale
  });
});
