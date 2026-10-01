import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { CowboyBeautyRoom } from '../../src/live/cowboy-beauty-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type { SettlementFailureReport, TableSettlementRequest } from '../../src/core/financial-core-client';

jest.mock('../../src/fairness/shuffle', () => {
  const actual = jest.requireActual<typeof import('../../src/fairness/shuffle')>('../../src/fairness/shuffle');
  return {
    ...actual,
    // Cowboy = deck[0], Beauty = deck[1]. A tie (P = 3/51 ≈ 5.9% with the live deck) voids the
    // round BEFORE settleTableHand is reached, so the injected rejection never fires. Pin Ace vs Two.
    shuffledDeck: (seed: string): string[] => ['As', '2h', ...actual.shuffledDeck(seed).filter((c) => c !== 'As' && c !== '2h')],
  };
});

const BUY_IN = 2_000;

const wait = (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for state');
}

describe('CowboyBeautyRoom — Live Room Integration', () => {
  it('registers cowboy-beauty table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const cbTable = hub.tables().find((t) => t.tableId === 'cowboy-beauty');
    expect(cbTable).toBeDefined();
    expect(cbTable?.variant).toBe('Cowboy & Beauty');
    await hub.close();
  });

  it('seats two players, resolves hand, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new CowboyBeautyRoom(
      {
        id: 'cowboy-beauty-1',
        name: 'Test Cowboy & Beauty',
        game: 'cowboy-beauty',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 100,
        freezeDurationMs: 50,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Alice bets on COWBOY, Bob bets on BEAUTY
    await room.command(alice, { kind: 'act', action: { type: 'COWBOY', amount: 150 } });
    await room.command(bob, { kind: 'act', action: { type: 'BEAUTY', amount: 250 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN');

    const snap = room.snapshotFor(alice);
    expect(snap.phase).toBe('SHOWDOWN');

    // Confirms the game really draws through the mocked `shuffledDeck` (the index.ts re-export is a
    // getter, not a copied value, so this also proves the getter forwards to the mock) — not just
    // that the round resolved. Ace vs Two: COWBOY always wins, never a tie.
    expect((snap.gameState as { cowboyCard: string; beautyCard: string; winner: string }).cowboyCard).toBe('As');
    expect((snap.gameState as { cowboyCard: string; beautyCard: string; winner: string }).beautyCard).toBe('2h');
    expect((snap.gameState as { cowboyCard: string; beautyCard: string; winner: string }).winner).toBe('COWBOY');

    // Verify ledger-level money conservation including rake sink
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);
});

/**
 * BUG-11: `resolveRound` called `game.start()` (which settles via FC) with no try/catch. A rejected
 * settlement — the ledger unreachable, a 409 — left the table stuck IN_HAND forever: nothing resets
 * `phase`, and a seat's `stack` mirror is only written by the net-delta loop AFTER `game.start()`
 * resolves, so a throw from it means no stack moved either. Mirrors the niu-niu-room recovery and
 * PokerRoom's own BUG-03 fix: `abandonRound` puts the table back to WAITING and reports the failure,
 * and the table deals again on its own rather than sitting dead.
 */
describe('CowboyBeautyRoom — settlement failure recovery (BUG-11)', () => {
  it('recovers to WAITING with stacks unchanged, reports the failure, and deals again', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;

    const realSettle = bank.settleTableHand.bind(bank);
    let calls = 0;
    bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('financial-core unreachable'));
      return realSettle(req);
    };
    const reportSpy = jest.fn<Promise<void>, [SettlementFailureReport]>().mockResolvedValue(undefined);
    (bank as unknown as { reportSettlementFailure: typeof reportSpy }).reportSettlementFailure = reportSpy;

    const room = new CowboyBeautyRoom(
      {
        id: 'cowboy-beauty-bug11',
        name: 'Test Cowboy & Beauty',
        game: 'cowboy-beauty',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 100,
        freezeDurationMs: 50,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    const before = new Map(room.snapshotFor(alice).seats.map((s) => [s.playerId, s.stack]));
    await room.command(alice, { kind: 'act', action: { type: 'COWBOY', amount: 150 } });
    await room.command(bob, { kind: 'act', action: { type: 'BEAUTY', amount: 250 } });

    await until(() => room.snapshotFor(alice).phase === 'WAITING', 10_000);
    for (const seat of room.snapshotFor(alice).seats) {
      expect(seat.stack).toBe(before.get(seat.playerId));
    }
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]![0]).toMatchObject({
      tableId: 'cowboy-beauty-bug11',
      reason: expect.stringContaining('financial-core unreachable'),
    });

    // The table recovers rather than freezing — a second hand deals on its own.
    await until(() => room.snapshotFor(alice).handNumber === 2, 10_000);
    room.dispose();
  }, 15_000);
});
