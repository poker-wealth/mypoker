import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { NiuNiuRoom } from '../../src/live/niu-niu-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type { SettlementFailureReport, TableSettlementRequest } from '../../src/core/financial-core-client';

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

describe('NiuNiuRoom — Live Room Integration', () => {
  it('registers niu-niu table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const niuNiuTable = hub.tables().find((t) => t.tableId === 'niu-niu');
    expect(niuNiuTable).toBeDefined();
    expect(niuNiuTable?.variant).toBe('Niu Niu');
    await hub.close();
  });

  it('seats two players, resolves hand, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const startingTotal = players.totalChips();

    const room = new NiuNiuRoom(
      {
        id: 'niu-niu-1',
        name: 'Test Niu Niu',
        game: 'niu-niu',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });

    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // The round opens with the bank auction now: bid first, then bet against whoever wins it.
    await room.command(alice, { kind: 'act', action: { type: 'bid-2' } });
    await room.command(bob, { kind: 'act', action: { type: 'bid-1' } });
    await until(() => room.snapshotFor(alice).stage === 'BETTING');

    // Bob bets against Alice's 2x bank
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN');

    const snap = room.snapshotFor(alice);
    expect(snap.phase).toBe('SHOWDOWN');

    // Verify ledger-level money conservation including rake sink
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  }, 15_000);
});

/**
 * BUG-11 follow-up: niu-niu-room had the identical latent defect the auditor caught in
 * baccarat-room — one `NiuNiuGame` built in the constructor and only advanced with
 * `nextRound()` on the success path. After an abandoned round the instance was left with a
 * banker still claimed and a state machine stuck in BETTING/RESOLVED, so the next round's
 * `claimBanker` threw `BankerTakenError`, or `placeBet`/`start` threw 'betting is closed',
 * forever. Fixed the same way as baccarat-room and lottery-room: a fresh `NiuNiuGame` per round.
 */
describe('NiuNiuRoom — settlement failure recovery (BUG-11 follow-up)', () => {
  it('a round that fails settlement is followed by a round that claims banker, bids, bets and settles normally', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;
    const carol = players.create('Carol').id;

    const realSettle = bank.settleTableHand.bind(bank);
    let calls = 0;
    bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('financial-core unreachable'));
      return realSettle(req);
    };
    const reportSpy = jest.fn<Promise<void>, [SettlementFailureReport]>().mockResolvedValue(undefined);
    (bank as unknown as { reportSettlementFailure: typeof reportSpy }).reportSettlementFailure = reportSpy;

    const room = new NiuNiuRoom(
      {
        id: 'niu-niu-bug11',
        name: 'Test Niu Niu',
        game: 'niu-niu',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await room.command(carol, { kind: 'sit', seat: 2, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    // Round 1: the auction and betting both close normally, but the settle for this round fails.
    await room.command(alice, { kind: 'act', action: { type: 'bid-2' } });
    await room.command(bob, { kind: 'act', action: { type: 'bid-1' } });
    await room.command(carol, { kind: 'act', action: { type: 'bid-1' } });
    await until(() => room.snapshotFor(alice).stage === 'BETTING');
    // A 2x bank's worst-case exposure per bet is stake x multiplier x 2 x MAX_HAND_MULTIPLIER(6);
    // two bettors at $50 keeps their combined exposure ($1,200) under Alice's $2,000 stack.
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 50 } });
    await room.command(carol, { kind: 'act', action: { type: 'bet', amount: 50 } });

    await until(() => room.snapshotFor(alice).phase === 'WAITING');
    expect(reportSpy).toHaveBeenCalledTimes(1);

    // Round 2: banker claim, auction and betting all work — none of them throw from round 1's
    // leftover banker claim or stale bets, which a reused game instance would still be holding.
    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 2,
      10_000,
    );
    await room.command(alice, { kind: 'act', action: { type: 'bid-2' } });
    await room.command(bob, { kind: 'act', action: { type: 'bid-1' } });
    await room.command(carol, { kind: 'act', action: { type: 'bid-1' } });
    await until(() => room.snapshotFor(alice).stage === 'BETTING');
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 50 } });
    await room.command(carol, { kind: 'act', action: { type: 'bet', amount: 50 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);
    expect(calls).toBe(2);

    room.dispose();
  }, 15_000);

  it('deals and settles round 2 after round 1 settles but a later step throws', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const bob = players.create('Bob').id;

    let settleCalls = 0;
    const realSettle = bank.settleTableHand.bind(bank);
    bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      settleCalls += 1;
      return realSettle(req);
    };

    const room = new NiuNiuRoom(
      {
        id: 'niu-niu-bug11-post-settle-throw',
        name: 'Test Niu Niu',
        game: 'niu-niu',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 5_000,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    let jackpotCalls = 0;
    const realProcessJackpot = (room as unknown as { processJackpot: (...a: unknown[]) => Promise<void> })
      .processJackpot.bind(room);
    (room as unknown as { processJackpot: (...a: unknown[]) => Promise<void> }).processJackpot = async (
      ...args: unknown[]
    ): Promise<void> => {
      jackpotCalls += 1;
      if (jackpotCalls === 1) throw new Error('jackpot pool unavailable');
      return realProcessJackpot(...args);
    };

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(bob, { kind: 'sit', seat: 1, buyIn: BUY_IN });
    await until(() => room.snapshotFor(alice).phase === 'IN_HAND');

    await room.command(alice, { kind: 'act', action: { type: 'bid-2' } });
    await room.command(bob, { kind: 'act', action: { type: 'bid-1' } });
    await until(() => room.snapshotFor(alice).stage === 'BETTING');
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });

    // Round 1's settlement went through (money moved) but the jackpot step threw, so the room
    // abandons — WAITING, then it deals round 2 on its own.
    await until(
      () => room.snapshotFor(alice).phase === 'IN_HAND' && room.snapshotFor(alice).handNumber === 2,
      10_000,
    );

    await room.command(alice, { kind: 'act', action: { type: 'bid-2' } });
    await room.command(bob, { kind: 'act', action: { type: 'bid-1' } });
    await until(() => room.snapshotFor(alice).stage === 'BETTING');
    await room.command(bob, { kind: 'act', action: { type: 'bet', amount: 100 } });

    await until(() => room.snapshotFor(alice).phase === 'SHOWDOWN', 10_000);
    expect(settleCalls).toBe(2);

    room.dispose();
  }, 15_000);
});
