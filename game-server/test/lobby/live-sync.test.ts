import { LobbyService } from '../../src/lobby/lobby-service';
import { syncLobbyWithLiveTables, type LiveTableIdentity } from '../../src/lobby/live-sync';
import { defaultTables } from '../../src/live/server';
import type { TableSummary } from '../../src/live/room-state';

/**
 * The lobby must only ever advertise tables that exist.
 *
 * The bug this pins: the gateway served a lobby seeded with `tx-1`, `nn-1`, … while the hub mounted
 * rooms called `texas`, `niu-niu`, …. Every row a player could tap answered `unknown table: tx-1`,
 * on the Mini App as well as the native app. Nothing failed — the lobby returned 200, the rows
 * rendered, and the error only appeared after a socket had been opened.
 *
 * So the assertion that matters is not "sync copies fields" but "every id the lobby publishes is
 * one the hub knows".
 */

const summary = (over: Partial<TableSummary> & { tableId: string }): TableSummary => ({
  name: 'T',
  variant: 'texas',
  smallBlind: 50,
  bigBlind: 100,
  minBuyIn: 4_000,
  maxBuyIn: 50_000,
  maxSeats: 9,
  seated: 0,
  phase: 'WAITING',
  ...over,
});

describe('syncLobbyWithLiveTables', () => {
  it('publishes only ids the hub actually serves', () => {
    const lobby = new LobbyService();
    // Pre-load the lobby with the old placeholder ids, exactly as dev-seed did.
    lobby.addTable({ id: 'tx-1', gameId: 'texas', stakes: 2_000_000, players: 6, jackpot: 52_000_000, buyInBB: 42 });
    lobby.addTable({ id: 'nn-1', gameId: 'niu-niu', stakes: 1_000_000, players: 5, jackpot: 3_000_000, buyInBB: 30 });

    const identities: LiveTableIdentity[] = [
      { id: 'texas', game: 'texas' },
      { id: 'niu-niu', game: 'niu-niu' },
    ];
    syncLobbyWithLiveTables(
      lobby,
      [summary({ tableId: 'texas' }), summary({ tableId: 'niu-niu', variant: 'niu-niu' })],
      identities,
    );

    const ids = lobby.listTables().map((t) => t.id).sort();
    expect(ids).toEqual(['niu-niu', 'texas']);
    // The placeholders are GONE, not merely outnumbered. A stale row is a table a player is sent to
    // and cannot join.
    expect(ids).not.toContain('tx-1');
    expect(ids).not.toContain('nn-1');
  });

  it('every real default table becomes a lobby row with a resolvable id', () => {
    const lobby = new LobbyService();
    const tables = defaultTables();
    const identities = tables.map((t) => ({ id: t.id, game: t.game }) as LiveTableIdentity);
    // `minBuyIn` is optional on some room configs; the fixture default stands in where it is absent.
    const summaries = tables.map((t) =>
      summary({
        tableId: t.id,
        variant: t.game,
        ...(t.minBuyIn === undefined ? {} : { minBuyIn: t.minBuyIn }),
      }),
    );

    syncLobbyWithLiveTables(lobby, summaries, identities);

    const published = new Set(lobby.listTables().map((t) => t.id));
    const real = new Set(tables.map((t) => t.id));
    for (const id of published) {
      expect(real.has(id)).toBe(true);
    }
    expect(published.size).toBe(real.size);
  });

  it('drops a table that has closed', () => {
    const lobby = new LobbyService();
    const identities: LiveTableIdentity[] = [
      { id: 'texas', game: 'texas' },
      { id: 'omaha', game: 'omaha' },
    ];

    syncLobbyWithLiveTables(
      lobby,
      [summary({ tableId: 'texas' }), summary({ tableId: 'omaha', variant: 'omaha' })],
      identities,
    );
    expect(lobby.listTables()).toHaveLength(2);

    // Omaha goes away.
    syncLobbyWithLiveTables(lobby, [summary({ tableId: 'texas' })], identities);
    expect(lobby.listTables().map((t) => t.id)).toEqual(['texas']);
  });

  it('tracks seat counts instead of freezing them', () => {
    const lobby = new LobbyService();
    const identities: LiveTableIdentity[] = [{ id: 'texas', game: 'texas' }];

    syncLobbyWithLiveTables(lobby, [summary({ tableId: 'texas', seated: 0 })], identities);
    expect(lobby.listTables()[0]?.players).toBe(0);

    syncLobbyWithLiveTables(lobby, [summary({ tableId: 'texas', seated: 4 })], identities);
    expect(lobby.listTables()[0]?.players).toBe(4);
  });

  it('advertises no jackpot rather than inventing one', () => {
    const lobby = new LobbyService();
    syncLobbyWithLiveTables(lobby, [summary({ tableId: 'texas' })], [{ id: 'texas', game: 'texas' }]);
    // Zero, which every client renders as OPEN. The web lobby once printed
    // `jackpot || stakes * 10`, advertising ten times the blind as a prize.
    expect(lobby.listTables()[0]?.jackpot).toBe(0);
  });
});
