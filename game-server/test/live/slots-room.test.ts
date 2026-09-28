import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { SlotsRoom } from '../../src/live/slots-room';
import { TableHub } from '../../src/live/table-hub';
import { defaultTables } from '../../src/live/server';
import type { TableSettlementRequest, WalletScope } from '../../src/core/financial-core-client';

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
