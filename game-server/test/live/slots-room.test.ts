import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { SlotsRoom } from '../../src/live/slots-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type { TableSettlementRequest, WalletScope } from '../../src/core/financial-core-client';
import { signResult, type RoundRequest, type SignedRoundResult } from '../../src/games/third-party/adapter';

const BUY_IN = 2_000;

describe('SlotsRoom — Live Room Integration', () => {
  it('registers slots table in defaultTables and TableHub', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      () => ({ playerId: 'nobody' }),
    );

    for (const table of defaultTables()) hub.addTable(table);

    const slotsTable = hub.tables().find((t) => t.tableId === 'slots');
    expect(slotsTable).toBeDefined();
    expect(slotsTable?.variant).toBe('Slots');
    await hub.close();
  });

  it('seats a player, spins slot, and conserves chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    const room = new SlotsRoom(
      {
        id: 'slots-1',
        name: 'Test Slots',
        game: 'slots',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        commissionBps: 500,
      },
      { directory: players, fc: bank },
    );
    const startingTotal = players.totalChips();

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    // Spin slots
    await room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } });

    const snap = room.snapshotFor(alice);
    expect(snap.handNumber).toBe(1);

    // Verify total chip conservation across the entire ledger and bank sinks
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);

    room.dispose();
  });
});

/**
 * BUG-10: the vendor PLAYER account starts at 0 against the real FC, so `buyIn(vendorId, '10000')`
 * 409s. That used to be swallowed silently (`.catch(() => {})`) — a winning spin then failed because
 * the unfunded vendor account could not pay it out, while a losing spin settled into the vendor
 * account as if nothing were wrong. Spins are now refused outright until the float actually funds.
 */
describe('SlotsRoom — vendor float funding gate (BUG-10)', () => {
  /** A ChipBank whose vendor `buyIn` rejects (real player buy-ins still go through). */
  function withUnfundedVendor(players: DevPlayers): { bank: ChipBank; settleCalls: () => number } {
    const bank = new ChipBank(players);
    const realBuyIn = bank.buyIn.bind(bank);
    const realSettle = bank.settleTableHand.bind(bank);
    let settleCalls = 0;
    bank.buyIn = (accountId: string, amount: string, scope?: WalletScope): Promise<void> => {
      if (accountId.startsWith('acc-slots-vendor:')) return Promise.reject(new Error('vendor account has no funds (409)'));
      return realBuyIn(accountId, amount, scope);
    };
    bank.settleTableHand = (req: TableSettlementRequest) => {
      settleCalls += 1;
      return realSettle(req);
    };
    return { bank, settleCalls: () => settleCalls };
  }

  it('refuses a spin — and never reaches settlement — while the vendor float has not funded', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const { bank, settleCalls } = withUnfundedVendor(players);
    const alice = players.create('Alice').id;

    const room = new SlotsRoom(
      {
        id: 'slots-unfunded',
        name: 'Test Slots',
        game: 'slots',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        commissionBps: 500,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    await expect(
      room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } }),
    ).rejects.toThrow(/vendor float not funded/);
    expect(settleCalls()).toBe(0);

    room.dispose();
  });

  it('spins once the vendor float funds', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players); // real buyIn — funds normally, as the dev/ChipBank path always has
    const alice = players.create('Alice').id;

    const room = new SlotsRoom(
      {
        id: 'slots-funded',
        name: 'Test Slots',
        game: 'slots',
        minBuyIn: 1_000,
        maxBuyIn: 50_000,
        maxSeats: 6,
        commissionBps: 500,
      },
      { directory: players, fc: bank },
    );

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await expect(
      room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } }),
    ).resolves.toBeUndefined();

    room.dispose();
  });
});

/**
 * BUG-10 follow-up. The original fix (38a86bf) bought the vendor float exactly once, in the
 * constructor: a boot-time FC outage left the room dead forever (no retry), every restart locked
 * ANOTHER float on top of whatever was already locked (nothing ever releases it, so it eventually
 * exhausts the vendor's available balance and 409s permanently), and the float (10,000) was smaller
 * than the worst case a single spin could owe (maxPayoutMultiple(100) × wager), so a big win could
 * be signed by the provider and then fail to settle because the vendor could not cover it.
 */
describe('SlotsRoom — vendor float retries, tops up, and caps stakes (BUG-10 follow-up)', () => {
  const baseConfig = {
    name: 'Test Slots',
    game: 'slots' as const,
    minBuyIn: 1_000,
    maxBuyIn: 50_000,
    maxSeats: 6,
    commissionBps: 500,
  };

  /** Spies a ChipBank's vendor-account `buyIn` calls without changing its behaviour. */
  function spyVendorBuyIn(bank: ChipBank): { amounts: string[] } {
    const state = { amounts: [] as string[] };
    const realBuyIn = bank.buyIn.bind(bank);
    bank.buyIn = (accountId: string, amount: string, scope?: WalletScope): Promise<void> => {
      if (accountId.startsWith('acc-slots-vendor:')) state.amounts.push(amount);
      return realBuyIn(accountId, amount, scope);
    };
    return state;
  }

  it('retries after a transient buyIn failure — first spin refused, second spin works', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    const realBuyIn = bank.buyIn.bind(bank);
    let vendorBuyInCalls = 0;
    bank.buyIn = (accountId: string, amount: string, scope?: WalletScope): Promise<void> => {
      if (accountId.startsWith('acc-slots-vendor:')) {
        vendorBuyInCalls += 1;
        // The constructor fires an unawaited funding attempt at boot (attempt #1); reject that one
        // too so the assertions below don't depend on whether it or the first spin's own attempt
        // gets there first — either way, the room is still unfunded until the third attempt.
        if (vendorBuyInCalls <= 2) return Promise.reject(new Error('FC unreachable'));
      }
      return realBuyIn(accountId, amount, scope);
    };

    const room = new SlotsRoom({ id: 'slots-retry', ...baseConfig }, { directory: players, fc: bank });

    // Let the constructor's own background funding attempt settle (and fail) before any spin runs,
    // so the first spin below is guaranteed to make its own attempt rather than share one already
    // in flight. Everything in that attempt is microtasks (no timers), so one macrotask tick is
    // enough for it to fully drain.
    await new Promise((resolve) => setImmediate(resolve));

    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });

    await expect(
      room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } }),
    ).rejects.toThrow(/vendor float not funded/);

    await expect(
      room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } }),
    ).resolves.toBeUndefined();

    expect(vendorBuyInCalls).toBe(3);
    room.dispose();
  });

  /**
   * Pre-locks chips in the vendor's REAL ledger entry before the room is constructed, rather than
   * stubbing `lockedBalance` to just claim a number: `ChipBank.lockedBalance` reads the same ledger
   * `settleTableHand` debits/credits from, so a vendor whose reported "locked" doesn't match what is
   * actually locked would make a real win's settlement fail with "insufficient locked chips" — this
   * keeps the two in sync the way the real FC always does.
   */
  function preLockVendorFloat(players: DevPlayers, tableId: string, amount: number): void {
    const vendorId = `acc-slots-vendor:${tableId}`;
    players.ensure(vendorId, { displayName: 'Slots Vendor' });
    players.lock(vendorId, amount);
  }

  it('does not buy in again when the vendor already holds at least the float', async () => {
    // Enough starting chips for `ensure()` to hand the vendor a big enough available balance to
    // pre-lock 12,000 into it below, on top of Alice's own buy-in.
    const players = new DevPlayers({ startingChips: 20_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    preLockVendorFloat(players, 'slots-already-funded', 12_000);
    const buyIns = spyVendorBuyIn(bank);

    const room = new SlotsRoom({ id: 'slots-already-funded', ...baseConfig }, { directory: players, fc: bank });
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } });

    expect(buyIns.amounts).toEqual([]);
    room.dispose();
  });

  it('tops up only the shortfall when the vendor holds a partial float', async () => {
    const players = new DevPlayers({ startingChips: 20_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    preLockVendorFloat(players, 'slots-partial-float', 4_000);
    const buyIns = spyVendorBuyIn(bank);

    const room = new SlotsRoom({ id: 'slots-partial-float', ...baseConfig }, { directory: players, fc: bank });
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } });

    expect(buyIns.amounts).toEqual(['6000']);
    room.dispose();
  });

  it('refuses a wager whose worst-case payout would exceed the vendor float, naming the max stake', async () => {
    const players = new DevPlayers({ startingChips: 100_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    let settleCalls = 0;
    const realSettle = bank.settleTableHand.bind(bank);
    bank.settleTableHand = (req: TableSettlementRequest): Promise<{ roundId: string; applied: boolean }> => {
      settleCalls += 1;
      return realSettle(req);
    };

    const room = new SlotsRoom({ id: 'slots-cap', ...baseConfig }, { directory: players, fc: bank });
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: 50_000 });

    // Vendor float funds to 10,000 (the default) on this very spin's ensureVendorFunded, before the
    // cap check runs. maxPayoutMultiple is 100, so the worst case is wager × 99; at wager 200 that's
    // 19,800 — far past the float. Math.floor(10000 / 99) = 101, the max stake the error must report.
    await expect(
      room.command(alice, { kind: 'act', action: { type: 'spin', amount: 200 } }),
    ).rejects.toThrow(/max stake is 101 chips/);

    expect(settleCalls).toBe(0);
    room.dispose();
  });

  it('tops the vendor float back up on the next spin after a big win depletes it', async () => {
    const players = new DevPlayers({ startingChips: 100_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const buyIns = spyVendorBuyIn(bank);

    const SECRET = 'slots-topup-test-secret';
    const room = new SlotsRoom(
      { id: 'slots-topup', ...baseConfig, secret: SECRET },
      { directory: players, fc: bank },
    );
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: 20_000 });

    // Force the provider's next result: a signed win the real reels would only rarely land on,
    // computed with the SAME secret the room configured its provider with, so it verifies exactly
    // as a real provider result would.
    (room as unknown as { provider: { playRound(req: RoundRequest): Promise<SignedRoundResult> } })
      .provider.playRound = async (req: RoundRequest): Promise<SignedRoundResult> => {
        const payout = req.wager * 90; // within the 100x cap, well past what the float alone covers twice
        return {
          result: { roundId: req.roundId, payout, outcome: { reels: ['SEVEN', 'SEVEN', 'SEVEN'], multiplier: 90 } },
          signature: signResult(SECRET, { ...req, payout }),
        };
      };

    // Spin 1: vendor float funds to 10,000 first, then a 100-chip wager (worst case 9,900) is
    // allowed. The forced win pays 9,000 (net 8,900), so the vendor float locally drops to 1,100 —
    // and the SAME amount actually leaves the vendor's locked balance at FC, since a winner's payout
    // is never trimmed by rake/jackpot on the loser's (the vendor's) side.
    await room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } });
    expect(buyIns.amounts).toEqual(['10000']);

    // Spin 2: vendor float (1,100) is below the target, so ensureVendorFunded tops it back up
    // before this spin's cap check runs — reading the vendor's REAL locked balance (also 1,100,
    // confirming the local tracking matches FC) and buying in exactly the 8,900 shortfall.
    await room.command(alice, { kind: 'act', action: { type: 'spin', amount: 50 } });
    expect(buyIns.amounts).toEqual(['10000', '8900']);

    room.dispose();
  });
});

/**
 * BUG-10 follow-up A. `receipt.net` is the PLAYER's net, not what FC actually moves for the
 * vendor's own account. On a player LOSS the vendor is the WINNER in the adapter's settlement, and
 * a winner's credit is trimmed by rake + the jackpot injection — so crediting the room's tracked
 * float with the full `|net|` (the old `vendorFloat -= receipt.net`) overstated every losing spin
 * by exactly that trim, drifting the tracked float upward forever versus what the vendor's real
 * locked balance actually holds. `receipt.providerDelta` fixes this by reading the exact amount off
 * the settlement request itself.
 */
describe('SlotsRoom — vendor float follows the real ledger, not the player\'s net (BUG-10 follow-up A)', () => {
  const baseConfig = {
    name: 'Test Slots',
    game: 'slots' as const,
    minBuyIn: 1_000,
    maxBuyIn: 50_000,
    maxSeats: 6,
    commissionBps: 500,
  };

  it('tracks losing spins at the rake-trimmed amount the vendor is actually credited, matching FC exactly', async () => {
    const players = new DevPlayers({ startingChips: 100_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;
    const tableId = 'slots-provider-delta';

    const SECRET = 'slots-provider-delta-test-secret';
    const room = new SlotsRoom(
      { id: tableId, ...baseConfig, secret: SECRET },
      { directory: players, fc: bank },
    );
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: 20_000 });

    // Force every spin to lose outright (signed payout 0), same technique as the top-up test above
    // — a signature made with the room's own configured secret, so it verifies exactly as a real
    // provider result would.
    (room as unknown as { provider: { playRound(req: RoundRequest): Promise<SignedRoundResult> } })
      .provider.playRound = async (req: RoundRequest): Promise<SignedRoundResult> => {
        const payout = 0;
        return {
          result: { roundId: req.roundId, payout, outcome: { reels: ['BAR', 'BAR', 'LEMON'] } },
          signature: signResult(SECRET, { ...req, payout }),
        };
      };

    // Five 100-chip losing spins. Each one: the player loses 100 outright; the vendor is the
    // WINNER of that 100 in the adapter's settlement, so at commissionBps 500 (5%) and the default
    // 0.5% jackpot rate it is credited 100 − 5 (rake) − 0 (floor(100×0.5%)) = 95, not the full 100.
    for (let i = 0; i < 5; i++) {
      await room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } });
    }

    const vendorId = `acc-slots-vendor:${tableId}`;
    const realLocked = Number(await bank.lockedBalance(vendorId));
    const trackedFloat = (room as unknown as { vendorFloat: number }).vendorFloat;

    // 10,000 initial float + 5 × 95 credited — never 10,000 + 5 × 100, which is what the pre-fix
    // `vendorFloat -= receipt.net` would have tracked.
    expect(realLocked).toBe(10_475);
    expect(trackedFloat).toBe(realLocked);

    room.dispose();
  });
});

/**
 * BUG-10 follow-up B. `financial-core-client.ts` documents `lockedBalance` as absent meaning the
 * caller should treat "locked" as UNKNOWN, never as zero — but `fundVendor` used to read `locked =
 * 0` whenever `this.fc.lockedBalance` was undefined, so it bought the FULL float on every single
 * top-up (stacking on top of whatever was already locked) instead of just the shortfall.
 */
describe('SlotsRoom — fundVendor when the locked balance is unknown (BUG-10 follow-up B)', () => {
  const baseConfig = {
    name: 'Test Slots',
    game: 'slots' as const,
    minBuyIn: 1_000,
    maxBuyIn: 50_000,
    maxSeats: 6,
    commissionBps: 500,
  };

  function spyVendorBuyIn(bank: ChipBank): { amounts: string[] } {
    const state = { amounts: [] as string[] };
    const realBuyIn = bank.buyIn.bind(bank);
    bank.buyIn = (accountId: string, amount: string, scope?: WalletScope): Promise<void> => {
      if (accountId.startsWith('acc-slots-vendor:')) state.amounts.push(amount);
      return realBuyIn(accountId, amount, scope);
    };
    return state;
  }

  /** Simulates a client (like `ChipDenominatedFc` fronting an inner client with no `lockedBalance`
   *  at all) where the field is genuinely absent — UNKNOWN, never zero. */
  function bankWithUnknownLockedBalance(players: DevPlayers): ChipBank {
    const bank = new ChipBank(players);
    (bank as unknown as { lockedBalance?: unknown }).lockedBalance = undefined;
    return bank;
  }

  it('buys the whole float on first funding, since nothing can be locked yet', async () => {
    const players = new DevPlayers({ startingChips: 20_000 });
    const bank = bankWithUnknownLockedBalance(players);
    const alice = players.create('Alice').id;
    const buyIns = spyVendorBuyIn(bank);

    const room = new SlotsRoom({ id: 'slots-unknown-first', ...baseConfig }, { directory: players, fc: bank });
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: BUY_IN });
    await room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } });

    expect(buyIns.amounts).toEqual(['10000']);
    room.dispose();
  });

  it('tops up only the local shortfall on a later top-up — never the full float again', async () => {
    const players = new DevPlayers({ startingChips: 100_000 });
    const bank = bankWithUnknownLockedBalance(players);
    const alice = players.create('Alice').id;
    const buyIns = spyVendorBuyIn(bank);

    const SECRET = 'slots-unknown-locked-test-secret';
    const room = new SlotsRoom(
      { id: 'slots-unknown-topup', ...baseConfig, secret: SECRET },
      { directory: players, fc: bank },
    );
    await room.command(alice, { kind: 'sit', seat: 0, buyIn: 20_000 });

    (room as unknown as { provider: { playRound(req: RoundRequest): Promise<SignedRoundResult> } })
      .provider.playRound = async (req: RoundRequest): Promise<SignedRoundResult> => {
        const payout = req.wager * 90; // within the 100x cap, well past what the float alone covers twice
        return {
          result: { roundId: req.roundId, payout, outcome: { reels: ['SEVEN', 'SEVEN', 'SEVEN'], multiplier: 90 } },
          signature: signResult(SECRET, { ...req, payout }),
        };
      };

    // Spin 1: first funding (locked unknown) buys the whole 10,000 float. The forced win pays
    // 9,000 (net 8,900) — the vendor is the loser here, so it pays the raw amount, no rake trim —
    // dropping the room's tracked float to 1,100.
    await room.command(alice, { kind: 'act', action: { type: 'spin', amount: 100 } });
    expect(buyIns.amounts).toEqual(['10000']);

    // Spin 2: ensureVendorFunded tops back up. With no real locked balance to read, it must buy
    // exactly the shortfall against what THIS room tracked (10,000 − 1,100 = 8,900) — not another
    // full 10,000 stacked on top, which is what the pre-fix `locked = 0` fallback would have bought.
    await room.command(alice, { kind: 'act', action: { type: 'spin', amount: 50 } });
    expect(buyIns.amounts).toEqual(['10000', '8900']);

    room.dispose();
  });
});
