import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';

/**
 * The creator's table options that live in the ROOM (the betting-engine ones —
 * straddle, all-in-or-fold, antes — are pinned in test/games/texas): the
 * auto-start count, restricting onlookers, hide hole-cards, and the same-IP /
 * same-GPS seat rules.
 */

const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  actionTimeoutMs: 80,
  disconnectGraceMs: 20,
  spectatorDelayMs: 0,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for the table to reach the expected state');
}

const sink = () => ({ sendSnapshot: () => {}, sendEvent: () => {} });

function harness(overrides: Partial<PokerRoomConfig> = {}) {
  const players = new DevPlayers({ startingChips: 10_000 });
  const bank = new ChipBank(players);
  const alice = players.create('Alice').id;
  const bob = players.create('Bob').id;
  const carol = players.create('Carol').id;
  const room = new PokerRoom(
    { ...FAST, id: 't1', name: 'Test table', ...overrides } as PokerRoomConfig,
    { directory: players, fc: bank },
  );
  return { room, players, alice, bob, carol };
}

describe('auto-start players count', () => {
  it('holds the first deal until the chosen number are seated', async () => {
    const h = harness({ autoStartPlayers: 3 });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    // Two are enough for poker but not for this table's rule.
    await wait(50);
    expect(h.room.snapshotFor(h.alice).phase).toBe('WAITING');

    await h.room.command(h.carol, { kind: 'sit', seat: 2, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
    h.room.dispose();
  });

  it('gates only the first hand — a departure does not freeze the table', async () => {
    const h = harness({ autoStartPlayers: 3 });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await h.room.command(h.carol, { kind: 'sit', seat: 2, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
    // Carol stands mid-session; the remaining two keep playing.
    await h.room.command(h.carol, { kind: 'stand' });
    await until(
      () => ['IN_HAND', 'DEALING', 'SHOWDOWN'].includes(h.room.snapshotFor(h.alice).phase),
      5_000,
    );
    h.room.dispose();
  });
});

describe('manual start — auto-start "None"', () => {
  it('waits for the owner, refuses anyone else, then deals', async () => {
    const h = harness({ autoStartPlayers: 0 });
    // The route writes ownerId from the verified token; the harness plays it.
    (h.room.config as { ownerId?: string }).ownerId = h.alice;
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await wait(50);
    expect(h.room.snapshotFor(h.alice).phase).toBe('WAITING');
    expect(h.room.snapshotFor(h.alice).awaitingStart).toBe(true);
    expect(h.room.snapshotFor(h.alice).isOwner).toBe(true);
    expect(h.room.snapshotFor(h.bob).isOwner).toBe(false);

    await expect(h.room.command(h.bob, { kind: 'start_game' })).rejects.toThrow(/creator/);

    await h.room.command(h.alice, { kind: 'start_game' });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
    expect(h.room.snapshotFor(h.alice).awaitingStart).toBeUndefined();
    h.room.dispose();
  });

  it('needs two funded players before the owner can start', async () => {
    const h = harness({ autoStartPlayers: 0 });
    (h.room.config as { ownerId?: string }).ownerId = h.alice;
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await expect(h.room.command(h.alice, { kind: 'start_game' })).rejects.toThrow(/two players/);
    h.room.dispose();
  });
});

describe('restricting onlookers', () => {
  it('refuses an unseated watcher and admits a seated player', async () => {
    const h = harness({ spectatorsAllowed: false });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    expect(() => h.room.join(h.bob, sink())).toThrow(/onlooker/);
    // The seated player reconnecting is not an onlooker.
    expect(() => h.room.join(h.alice, sink())).not.toThrow();
    h.room.dispose();
  });

  it('changes nothing when the option is off', () => {
    const h = harness();
    expect(() => h.room.join(h.bob, sink())).not.toThrow();
    h.room.dispose();
  });
});

describe('hide hole-cards', () => {
  it('keeps your own cards face-down preflop until it is your turn', async () => {
    const h = harness({ hideHoleCards: true });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');

    const toActSeat = h.room.snapshotFor(h.alice).toActSeat!;
    const seatOf: Record<number, string> = { 0: h.alice, 1: h.bob };
    const acting = seatOf[toActSeat]!;
    const watching = acting === h.alice ? h.bob : h.alice;

    const actingCards = h.room
      .snapshotFor(acting)
      .seats.find((s) => s.isYou)!.cards;
    const watchingCards = h.room
      .snapshotFor(watching)
      .seats.find((s) => s.isYou)!.cards;

    // On the clock: your cards. Waiting for your first turn: card backs.
    expect(actingCards.every((c) => typeof c === 'string')).toBe(true);
    expect(watchingCards.every((c) => c === null)).toBe(true);
    h.room.dispose();
  });

  it('shows everyone their own cards from the flop on', async () => {
    const h = harness({ hideHoleCards: true });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
    const seatOf: Record<number, string> = { 0: h.alice, 1: h.bob };
    // Play the preflop street out.
    for (let guard = 0; guard < 10; guard++) {
      const view = h.room.snapshotFor(h.alice);
      if (view.street !== 'PREFLOP' || view.toActSeat === null) break;
      const playerId = seatOf[view.toActSeat]!;
      const legal = h.room.snapshotFor(playerId).legal!;
      await h.room.command(playerId, {
        kind: 'act',
        action: legal.canCheck ? { type: 'check' } : { type: 'call' },
      });
    }
    await until(() => h.room.snapshotFor(h.alice).street !== 'PREFLOP');
    for (const id of [h.alice, h.bob]) {
      const mine = h.room.snapshotFor(id).seats.find((s) => s.isYou)!.cards;
      expect(mine.every((c) => typeof c === 'string')).toBe(true);
    }
    h.room.dispose();
  });
});

describe('same-IP and same-GPS seat rules', () => {
  it('refuses a second seat from the same IP when the rule is on', async () => {
    const h = harness({ banSameIp: true });
    h.room.join(h.alice, sink(), { ip: '203.0.113.9' });
    h.room.join(h.bob, sink(), { ip: '203.0.113.9' });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await expect(
      h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 }),
    ).rejects.toThrow(/same IP/);
    // A different address sits fine.
    h.room.join(h.carol, sink(), { ip: '198.51.100.7' });
    await h.room.command(h.carol, { kind: 'sit', seat: 2, buyIn: 2_000 });
    h.room.dispose();
  });

  it('same IP is allowed when the rule is off', async () => {
    const h = harness();
    h.room.join(h.alice, sink(), { ip: '203.0.113.9' });
    h.room.join(h.bob, sink(), { ip: '203.0.113.9' });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000 });
    h.room.dispose();
  });

  it('refuses a second seat from the same reported GPS point', async () => {
    const h = harness({ banSameGps: true });
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000, gps: '1.30,103.85' });
    await expect(
      h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 2_000, gps: '1.30,103.85' }),
    ).rejects.toThrow(/GPS/);
    // No location reported → no match → seated. The rule bites only on
    // evidence actually held; see assertNetRulesAllow.
    await h.room.command(h.carol, { kind: 'sit', seat: 2, buyIn: 2_000 });
    h.room.dispose();
  });
});
