import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM, PokerRoom, type PokerRoomConfig } from '../../src/live/poker-room';
import type { TableSnapshot } from '../../src/live/room-state';
import type { SettlementFailureReport, TableSettlementRequest, WalletScope } from '../../src/core/financial-core-client';
import type { PlayerDirectory, TablePlayer } from '../../src/live/players';

/**
 * Two people, two devices, one table. These tests drive the room exactly as the client does —
 * only through commands and snapshots — because that is the whole security claim: nothing a
 * client sends and nothing a client sees can give it an edge.
 */

const FAST: Omit<PokerRoomConfig, 'id' | 'name'> = {
  ...DEFAULT_ROOM,
  maxSeats: 6,
  handStartDelayMs: 10,
  showdownDelayMs: 10,
  actionTimeoutMs: 80,
  disconnectGraceMs: 20,
  // Tests watch through unseated viewers; a real spectator lag would just slow them down.
  spectatorDelayMs: 0,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a condition rather than for a duration. The room is timer-driven and a loaded machine
 * runs timers late, so polling keeps these tests about behaviour instead of about the clock.
 */
async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for the table to reach the expected state');
}

interface Harness {
  room: PokerRoom;
  players: DevPlayers;
  bank: ChipBank;
  alice: string;
  bob: string;
  /** Total chips that existed before anyone sat down. */
  startingTotal: number;
}

function harness(overrides: Partial<PokerRoomConfig> = {}): Harness {
  const players = new DevPlayers({ startingChips: 10_000 });
  const bank = new ChipBank(players);
  const alice = players.create('Alice').id;
  const bob = players.create('Bob').id;
  const room = new PokerRoom({ ...FAST, id: 't1', name: 'Test table', ...overrides } as PokerRoomConfig, {
    directory: players,
    fc: bank,
  });
  return { room, players, bank, alice, bob, startingTotal: players.totalChips() };
}

/** Play the hand out with the cheapest legal action, as a bored player would. */
async function playToShowdown(h: Harness, seatOf: Record<number, string>): Promise<void> {
  for (let guard = 0; guard < 200; guard++) {
    const view = h.room.snapshotFor(h.alice);
    if (view.phase !== 'IN_HAND' || view.toActSeat === null) return;
    const playerId = seatOf[view.toActSeat]!;
    const legal = h.room.snapshotFor(playerId).legal!;
    await h.room.command(playerId, {
      kind: 'act',
      action: legal.canCheck ? { type: 'check' } : { type: 'call' },
    });
  }
  throw new Error('hand did not finish');
}

/** Sit both players down and wait for the cards to come out. */
async function seatBoth(h: Harness, seatA: number, seatB: number): Promise<void> {
  await h.room.command(h.alice, { kind: 'sit', seat: seatA, buyIn: 2_000 });
  await h.room.command(h.bob, { kind: 'sit', seat: seatB, buyIn: 2_000 });
  await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
}

describe('PokerRoom — a table real people sit at', () => {
  it('deals as soon as two players have bought in', async () => {
    const h = harness();
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    expect(h.room.snapshotFor(h.alice).phase).toBe('WAITING'); // one player is not a game

    await h.room.command(h.bob, { kind: 'sit', seat: 3, buyIn: 2_000 });
    expect(h.room.snapshotFor(h.alice).phase).toBe('DEALING');

    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND');
    const view = h.room.snapshotFor(h.alice);
    expect(view.seats).toHaveLength(2);
    expect(view.pot + view.seats.reduce((sum, s) => sum + s.bet, 0)).toBe(30); // blinds 10 + 20
    h.room.dispose();
  });

  it('never puts an opponent’s hole cards in your snapshot', async () => {
    const h = harness();
    await seatBoth(h, 0, 1);

    const view = h.room.snapshotFor(h.alice);
    const mine = view.seats.find((s) => s.isYou)!;
    const theirs = view.seats.find((s) => !s.isYou)!;

    expect(mine.cards.every((c) => typeof c === 'string')).toBe(true);
    expect(theirs.cards).toEqual([null, null]); // face-down, and that is all the client is told

    // Bob's actual cards appear nowhere Alice can read them. Checked against the fields that carry
    // cards rather than by searching the whole payload — a card like '9c' is valid hex and collides
    // with the fairness hashes often enough to fail at random.
    const bobsCards = h.room.snapshotFor(h.bob).seats.find((s) => s.isYou)!.cards;
    const visibleToAlice = [...view.board, ...view.seats.filter((s) => !s.isYou).flatMap((s) => s.cards)];
    for (const card of bobsCards) expect(visibleToAlice).not.toContain(card);
    h.room.dispose();
  });

  it('only the player to act is given legal actions', async () => {
    const h = harness();
    await seatBoth(h, 0, 1);

    const seatOf: Record<number, string> = { 0: h.alice, 1: h.bob };
    const toAct = h.room.snapshotFor(h.alice).toActSeat!;
    const waiting = toAct === 0 ? h.bob : h.alice;

    expect(h.room.snapshotFor(seatOf[toAct]!).legal).not.toBeNull();
    expect(h.room.snapshotFor(waiting).legal).toBeNull();
    await expect(h.room.command(waiting, { kind: 'act', action: { type: 'fold' } })).rejects.toThrow(
      /not your turn/,
    );
    h.room.dispose();
  });

  it('plays a full hand and conserves every chip', async () => {
    const h = harness();
    await seatBoth(h, 0, 2);
    await playToShowdown(h, { 0: h.alice, 2: h.bob });

    const view = h.room.snapshotFor(h.alice);
    expect(view.phase).toBe('SHOWDOWN');
    expect(view.message).toMatch(/wins/);
    expect(view.winners.length).toBeGreaterThan(0);
    expect(view.board).toHaveLength(5);
    // Both hands are face-up at showdown.
    for (const seat of view.seats) expect(seat.cards.every((c) => typeof c === 'string')).toBe(true);
    // The pot went somewhere real: players + house sinks still hold exactly what we started with.
    expect(h.players.totalChips() + h.bank.sinkTotal()).toBe(h.startingTotal);
    h.room.dispose();
  });

  it('a league table settles its hand as LEAGUE, carrying the leagueId', async () => {
    // The gap that kept league tables off the floor: PokerRoom hardcoded tableType PLATFORM, so a
    // league hand's rake would have routed to the platform Treasury. The room must settle as what the
    // table actually is; the Financial Core then sends the rake to League Inventory.
    const h = harness({ tableType: 'LEAGUE', leagueId: 'league-7' });
    let settled: TableSettlementRequest | null = null;
    const realSettle = h.bank.settleTableHand.bind(h.bank);
    h.bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      settled = req;
      return realSettle(req);
    };

    await seatBoth(h, 0, 1);
    await playToShowdown(h, { 0: h.alice, 1: h.bob });
    await until(() => settled !== null);

    expect(settled!.tableType).toBe('LEAGUE');
    expect(settled!.leagueId).toBe('league-7');
    h.room.dispose();
  });

  it('a platform table still settles as PLATFORM, with no leagueId', async () => {
    const h = harness(); // default config — no tableType set
    let settled: TableSettlementRequest | null = null;
    const realSettle = h.bank.settleTableHand.bind(h.bank);
    h.bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      settled = req;
      return realSettle(req);
    };

    await seatBoth(h, 0, 1);
    await playToShowdown(h, { 0: h.alice, 1: h.bob });
    await until(() => settled !== null);

    expect(settled!.tableType).toBe('PLATFORM');
    expect(settled!.leagueId).toBeUndefined();
    h.room.dispose();
  });

  // BUG-02: a league table locked and released the PLATFORM wallet while settlement resolved the
  // LEAGUE wallet — the buy-in came from an account settlement never touched. buyIn/release must
  // carry the same (tableType, leagueId) scope settlement already does.
  it('a league table sends its wallet scope on buyIn and release', async () => {
    const h = harness({ tableType: 'LEAGUE', leagueId: 'league-7' });
    const buyInScopes: (WalletScope | undefined)[] = [];
    const releaseScopes: (WalletScope | undefined)[] = [];
    const realBuyIn = h.bank.buyIn.bind(h.bank);
    const realRelease = h.bank.release.bind(h.bank);
    h.bank.buyIn = (playerAccountId: string, amount: string, scope?: WalletScope): Promise<void> => {
      buyInScopes.push(scope);
      return realBuyIn(playerAccountId, amount, scope);
    };
    h.bank.release = (playerAccountId: string, amount: string, scope?: WalletScope): Promise<void> => {
      releaseScopes.push(scope);
      return realRelease(playerAccountId, amount, scope);
    };

    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await h.room.command(h.alice, { kind: 'stand' });

    expect(buyInScopes).toEqual([{ tableType: 'LEAGUE', leagueId: 'league-7' }]);
    expect(releaseScopes).toEqual([{ tableType: 'LEAGUE', leagueId: 'league-7' }]);
    h.room.dispose();
  });

  // D1: topUp had the same bug sit() did before BUG-02 — it read `player.available` from the
  // directory, which only ever caches the PLATFORM balance, and refused a top-up on a LEAGUE table
  // whose real (league-wallet) balance the directory has no way to know. The directory here reports
  // 0 regardless of what the ledger actually holds, so a league top-up must go through anyway —
  // FC's own overdraft guard on the league wallet is what actually protects it.
  it('a league table tops up even when the directory reports 0 available, and sends the league scope', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    const zeroBalance: TablePlayer = {
      id: alice,
      displayName: 'Alice',
      available: 0,
      reputationScore: 1000,
    };
    const zeroBalanceDirectory: PlayerDirectory = {
      find: () => zeroBalance,
      ensure: () => zeroBalance,
    };

    const room = new PokerRoom(
      { ...FAST, id: 't-league-topup', name: 'Test table', tableType: 'LEAGUE', leagueId: 'league-7' } as PokerRoomConfig,
      { directory: zeroBalanceDirectory, fc: bank },
    );

    const buyInScopes: (WalletScope | undefined)[] = [];
    const realBuyIn = bank.buyIn.bind(bank);
    bank.buyIn = (playerAccountId: string, amount: string, scope?: WalletScope): Promise<void> => {
      buyInScopes.push(scope);
      return realBuyIn(playerAccountId, amount, scope);
    };

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    await expect(room.command(alice, { kind: 'buyIn', amount: 500 })).resolves.toBeUndefined();

    expect(buyInScopes).toEqual([
      { tableType: 'LEAGUE', leagueId: 'league-7' },
      { tableType: 'LEAGUE', leagueId: 'league-7' },
    ]);
    room.dispose();
  });

  it('a platform table sends the PLATFORM scope, with no leagueId', async () => {
    const h = harness(); // default config — no tableType set
    const buyInScopes: (WalletScope | undefined)[] = [];
    const realBuyIn = h.bank.buyIn.bind(h.bank);
    h.bank.buyIn = (playerAccountId: string, amount: string, scope?: WalletScope): Promise<void> => {
      buyInScopes.push(scope);
      return realBuyIn(playerAccountId, amount, scope);
    };

    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });

    expect(buyInScopes).toEqual([{ tableType: 'PLATFORM' }]);
    h.room.dispose();
  });

  it('rolls into the next hand and moves the button', async () => {
    const h = harness();
    await seatBoth(h, 0, 2);

    const firstButton = h.room.snapshotFor(h.alice).seats.find((s) => s.isDealer)!.index;
    await playToShowdown(h, { 0: h.alice, 2: h.bob });
    await until(() => h.room.snapshotFor(h.alice).handNumber === 2);

    const next = h.room.snapshotFor(h.alice);
    expect(next.seats.find((s) => s.isDealer)!.index).not.toBe(firstButton);
    h.room.dispose();
  });

  it('acts for a player whose clock runs out', async () => {
    const h = harness();
    await seatBoth(h, 0, 1);

    const stalledSeat = h.room.snapshotFor(h.alice).toActSeat!;
    // Nobody acts. The clock has to act for them, or the hand ends outright.
    await until(() => {
      const now = h.room.snapshotFor(h.alice);
      return now.toActSeat === null || now.toActSeat !== stalledSeat;
    });

    const after = h.room.snapshotFor(h.alice);
    expect(after.toActSeat === null || after.toActSeat !== stalledSeat).toBe(true);
    h.room.dispose();
  });

  it('returns an abandoned player’s chips instead of locking them forever', async () => {
    const h = harness({ disconnectGraceMs: 5 });
    const stopWatching = h.room.join(h.alice, { sendSnapshot: () => {}, sendEvent: () => {} });
    await seatBoth(h, 0, 1);

    stopWatching(); // Alice's phone drops off mid-hand
    await playToShowdown(h, { 0: h.alice, 1: h.bob });
    // Grace expires and she is sat out; the abandon timer then frees the chair.
    await until(() => h.room.snapshotFor(h.alice).yourSeat === null);

    expect(h.players.locked(h.alice)).toBe(0); // nothing of hers is stranded at the table
    expect(h.players.locked(h.bob)).toBeGreaterThan(0); // Bob is still sitting there
    expect(h.players.totalChips() + h.bank.sinkTotal()).toBe(h.startingTotal);
    h.room.dispose();
  });

  it('gives a player their chips back when they stand up', async () => {
    const h = harness();
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    expect(h.players.available(h.alice)).toBe(8_000);

    await h.room.command(h.alice, { kind: 'stand' });
    expect(h.players.available(h.alice)).toBe(10_000);
    expect(h.room.snapshotFor(h.alice).yourSeat).toBeNull();
    h.room.dispose();
  });

  it('refuses a seat that is taken, and a buy-in you cannot cover', async () => {
    const h = harness();
    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });

    await expect(h.room.command(h.bob, { kind: 'sit', seat: 0, buyIn: 2_000 })).rejects.toThrow(/seat taken/);
    await expect(h.room.command(h.bob, { kind: 'sit', seat: 1, buyIn: 99_000 })).rejects.toThrow(/buy-in must be/);
    expect(h.players.available(h.bob)).toBe(10_000); // nothing was locked by the failed attempts
    h.room.dispose();
  });

  it('pushes a snapshot to every watcher when the table changes', async () => {
    const h = harness();
    const seen: TableSnapshot[] = [];
    const stop = h.room.join(h.bob, { sendSnapshot: (snapshot: TableSnapshot) => { seen.push(snapshot); }, sendEvent: () => {} });

    await h.room.command(h.alice, { kind: 'sit', seat: 0, buyIn: 2_000 });
    expect(seen.length).toBeGreaterThanOrEqual(2); // initial + the sit
    expect(seen.at(-1)!.seats[0]!.name).toBe('Alice');

    stop();
    const countAfterLeaving = seen.length;
    await h.room.command(h.alice, { kind: 'stand' });
    expect(seen.length).toBe(countAfterLeaving); // unsubscribed means unsubscribed
    h.room.dispose();
  });
});

/**
 * BUG-03: settlement can throw AFTER a hand completes (network error, 5xx, 409 — and
 * `settleTableHand`'s own deliberate throw on `applied: false`). Before this fix nothing caught it:
 * the room stayed in IN_HAND/SETTLING forever, nobody could act, and stand/close never completed.
 *
 * The recovery is narrow on purpose, mirroring `BaseLiveRoom.abandonRound`: `TexasGame.settle` only
 * touches a seat's stack AFTER `fc.settleTableHand` resolves, and this room's own `seat.stack` mirror
 * is only written by `finishHand` — which never runs when settlement throws. So a failed settlement
 * really does mean nothing moved, and "recovery" is just putting the table back to WAITING.
 */
describe('PokerRoom — settlement failure recovery (BUG-03)', () => {
  /** Reject the FIRST settlement (whatever hand hits it), then let every later one through for real. */
  function failFirstSettlement(h: Harness): { calls: number } {
    const state = { calls: 0 };
    const realSettle = h.bank.settleTableHand.bind(h.bank);
    h.bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      state.calls += 1;
      if (state.calls === 1) return Promise.reject(new Error('financial-core unreachable'));
      return realSettle(req);
    };
    return state;
  }

  it('recovers to WAITING with every stack unchanged, reports the failure, and deals again', async () => {
    const h = harness();
    failFirstSettlement(h);
    const reportSpy = jest.fn<Promise<void>, [SettlementFailureReport]>().mockResolvedValue(undefined);
    (h.bank as unknown as { reportSettlementFailure: typeof reportSpy }).reportSettlementFailure = reportSpy;

    await seatBoth(h, 0, 1);
    const before = new Map(h.room.snapshotFor(h.alice).seats.map((s) => [s.playerId, s.stack]));

    await playToShowdown(h, { 0: h.alice, 1: h.bob });
    // The command that drove the hand to completion awaits abandonHand fully, so phase is already
    // WAITING by the time playToShowdown returns — polled anyway so this test isn't timing-fragile.
    await until(() => h.room.snapshotFor(h.alice).phase === 'WAITING');

    for (const seat of h.room.snapshotFor(h.alice).seats) {
      expect(seat.stack).toBe(before.get(seat.playerId)); // nothing paid, nothing lost
    }
    expect(h.players.totalChips() + h.bank.sinkTotal()).toBe(h.startingTotal);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0]![0]).toMatchObject({
      tableId: 't1',
      reason: expect.stringContaining('financial-core unreachable'),
    });

    // The table recovers rather than freezing — a second hand deals on its own.
    await until(() => h.room.snapshotFor(h.alice).phase === 'IN_HAND' && h.room.snapshotFor(h.alice).handNumber === 2);
    h.room.dispose();
  });

  it('recovers the same way when the failing settlement is driven by the action-timeout path', async () => {
    const h = harness();
    const state = failFirstSettlement(h);
    // Watching (not just seated) keeps both seats `connected`, so the clock-driven fold below does
    // not ALSO mark the timed-out player `sittingOut` — a real client watches its own table, and an
    // unwatched seat sitting out on its first timeout is an unrelated, correct behaviour this test
    // must not trip over.
    const stopAlice = h.room.join(h.alice, { sendSnapshot: () => {}, sendEvent: () => {} });
    const stopBob = h.room.join(h.bob, { sendSnapshot: () => {}, sendEvent: () => {} });
    await seatBoth(h, 0, 1);
    const before = new Map(h.room.snapshotFor(h.alice).seats.map((s) => [s.playerId, s.stack]));

    // Nobody sends an `act` command: heads-up preflop, the player to act faces the big blind and
    // cannot check, so the action clock folds them — ending the hand, and driving settlement, with
    // no explicit action at all.
    await until(() => state.calls >= 1);

    // The WAITING phase itself is transient — the table redeals within showdownDelayMs — so assert
    // on the money and on the redeal actually happening, rather than trying to catch WAITING mid-flight.
    for (const seat of h.room.snapshotFor(h.alice).seats) {
      expect(seat.stack).toBe(before.get(seat.playerId));
    }
    await until(() => h.room.snapshotFor(h.alice).handNumber >= 2);
    stopAlice();
    stopBob();
    h.room.dispose();
  });

  it('still releases a leaveAfterHand seat once the abandoned hand ends', async () => {
    const h = harness();
    failFirstSettlement(h);
    await seatBoth(h, 0, 1);

    const seatOf: Record<number, string> = { 0: h.alice, 1: h.bob };
    const toAct = h.room.snapshotFor(h.alice).toActSeat!;
    const notToAct = toAct === 0 ? h.bob : h.alice;
    // Not their turn, so this only queues leaveAfterHand — it does not fold them.
    await h.room.command(notToAct, { kind: 'stand' });

    await playToShowdown(h, seatOf);
    await until(() => h.room.snapshotFor(h.alice).phase === 'WAITING');

    expect(h.room.hasSeated(notToAct)).toBe(false); // released even though settlement never ran
    expect(h.players.available(notToAct)).toBe(10_000); // whole stack back
    h.room.dispose();
  });

  it('lets a pending close finish closing instead of dealing another hand', async () => {
    const h = harness();
    (h.room.config as { ownerId?: string }).ownerId = h.alice;
    failFirstSettlement(h);

    await seatBoth(h, 0, 1);
    await h.room.command(h.alice, { kind: 'close_table' }); // queued — the hand in progress finishes first

    await playToShowdown(h, { 0: h.alice, 1: h.bob });
    // The abandoned hand must hand off to the pending close rather than dealing another one.
    await until(() => h.room.snapshotFor(h.alice).seats.length === 0);

    expect(h.players.available(h.alice)).toBe(10_000);
    expect(h.players.available(h.bob)).toBe(10_000);
    h.room.dispose();
  });

  it('still throws normally on an illegal action — that is not a settlement failure', async () => {
    const h = harness();
    failFirstSettlement(h); // present but irrelevant: the hand never reaches settlement
    await seatBoth(h, 0, 1);

    const seatOf: Record<number, string> = { 0: h.alice, 1: h.bob };
    const toAct = h.room.snapshotFor(h.alice).toActSeat!;
    // Preflop, facing the big blind: checking is illegal (must call, raise or fold).
    await expect(
      h.room.command(seatOf[toAct]!, { kind: 'act', action: { type: 'check' } }),
    ).rejects.toThrow();

    // Not abandoned: same hand, still in progress, nobody's chips moved.
    expect(h.room.snapshotFor(h.alice).phase).toBe('IN_HAND');
    expect(h.room.snapshotFor(h.alice).handNumber).toBe(1);
    h.room.dispose();
  });
});
