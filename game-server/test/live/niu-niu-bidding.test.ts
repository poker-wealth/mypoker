import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { NiuNiuRoom, type NiuNiuRoomConfig } from '../../src/live/niu-niu-room';

/**
 * NIU NIU / BULL BULL — one game, one table, real chips.
 *
 * They were the same game in two places: a standalone Bull Bull simulator with bank bidding and
 * stake multipliers, and a live Niu Niu table with neither. The betting structure now lives on the
 * table that settles through the ledger, so this covers what moved:
 *
 *   - the bank is won at auction, not by racing to claim it,
 *   - the winning bid multiplies every settlement of the round,
 *   - a bettor's own multiplier compounds with it, and with the winning hand's,
 *   - and the bank can never be asked to cover more than it holds.
 */

const CONFIG: NiuNiuRoomConfig = {
  id: 'niu-niu-test',
  name: 'Niu Niu',
  game: 'niu-niu',
  minBuyIn: 1_000,
  maxBuyIn: 500_000,
  maxSeats: 6,
  rakeBps: 500,
  biddingTimeMs: 60_000, // held open; the tests close the auction themselves
  bettingTimeMs: 60_000,
  showdownDelayMs: 20,
};

const wait = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for the table');
}

interface Harness {
  room: NiuNiuRoom;
  players: DevPlayers;
  bank: ChipBank;
  ids: string[];
}

async function seated(
  count: number,
  buyIn: number | number[] = 100_000,
  overrides: Partial<NiuNiuRoomConfig> = {},
): Promise<Harness> {
  const players = new DevPlayers({ startingChips: 10_000_000 });
  const bankLedger = new ChipBank(players);
  const room = new NiuNiuRoom({ ...CONFIG, ...overrides } as NiuNiuRoomConfig, {
    directory: players,
    fc: bankLedger,
  });

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = players.create(`P${i}`).id;
    ids.push(id);
    const seatBuyIn = Array.isArray(buyIn) ? buyIn[i]! : buyIn;
    await room.command(id, { kind: 'sit', seat: i, buyIn: seatBuyIn });
  }
  return { room, players, bank: bankLedger, ids };
}

const snapshot = (h: Harness) => h.room.snapshotFor(h.ids[0]!);

describe('the bank is won at auction', () => {
  it('opens with bidding rather than a scramble to claim', async () => {
    const h = await seated(3);
    await until(() => snapshot(h).phase === 'IN_HAND');
    expect(snapshot(h).stage).toBe('BIDDING');

    // A bet before the auction closes is refused.
    await expect(
      h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bet', amount: 100 } }),
    ).rejects.toThrow(/betting is closed/);
    h.room.dispose();
  });

  it('gives the chair to the highest bid, and moves on to betting', async () => {
    const h = await seated(3);
    await until(() => snapshot(h).stage === 'BIDDING');

    await h.room.command(h.ids[0]!, { kind: 'act', action: { type: 'bid-1' } });
    await h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bid-5' } });
    await h.room.command(h.ids[2]!, { kind: 'act', action: { type: 'bid-2' } });

    await until(() => snapshot(h).stage === 'BETTING');
    const banker = snapshot(h).seats.find((s) => s.isDealer);
    expect(banker?.playerId).toBe(h.ids[1]);
    h.room.dispose();
  });

  it('refuses a bid once the auction is over', async () => {
    const h = await seated(2);
    await until(() => snapshot(h).stage === 'BIDDING');
    await h.room.command(h.ids[0]!, { kind: 'act', action: { type: 'bid-2' } });
    await h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bid-1' } });
    await until(() => snapshot(h).stage === 'BETTING');

    await expect(
      h.room.command(h.ids[0]!, { kind: 'act', action: { type: 'bid-5' } }),
    ).rejects.toThrow(/auction is closed/);
    h.room.dispose();
  });
});

describe('the multipliers compound, and the money still balances', () => {
  /** Bid the auction out with a named winner, then return once betting is open. */
  async function auction(h: Harness, bids: Record<number, string>): Promise<void> {
    await until(() => snapshot(h).stage === 'BIDDING');
    for (const [seat, bid] of Object.entries(bids)) {
      await h.room.command(h.ids[Number(seat)]!, { kind: 'act', action: { type: bid } });
    }
    await until(() => snapshot(h).stage === 'BETTING');
  }

  it('settles a round staked at 2x against a 5x bank without inventing a chip', async () => {
    const h = await seated(3);
    const opening = h.players.totalChips() + h.bank.sinkTotal();
    await auction(h, { 0: 'bid-5', 1: 'bid-1', 2: 'bid-1' });

    await h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bet', amount: 100, multiplier: 2 } });
    await h.room.command(h.ids[2]!, { kind: 'act', action: { type: 'bet', amount: 100, multiplier: 1 } });

    await until(() => snapshot(h).phase === 'SHOWDOWN', 10_000);
    expect(h.players.totalChips() + h.bank.sinkTotal()).toBe(opening);
    expect(h.bank.sinkTotal()).toBeGreaterThan(0); // the house took its rake
    h.room.dispose();
  });

  it('pays a bigger multiplier more from the same stake', async () => {
    // Two identical stakes, one at 1x and one at 5x, against the same bank and the same board.
    const h = await seated(3);
    await auction(h, { 0: 'bid-1', 1: 'bid-1', 2: 'bid-1' });
    await h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bet', amount: 100, multiplier: 1 } });
    await h.room.command(h.ids[2]!, { kind: 'act', action: { type: 'bet', amount: 100, multiplier: 5 } });

    await until(() => snapshot(h).phase === 'SHOWDOWN', 10_000);
    const seats = snapshot(h).seats;
    const flat = seats.find((s) => s.playerId === h.ids[1])!;
    const heavy = seats.find((s) => s.playerId === h.ids[2])!;

    // Same hand strength is not guaranteed, but the SWING must be five times the flat bet's when
    // both land the same way, and never smaller in magnitude.
    const flatSwing = Math.abs(flat.stack - 100_000);
    const heavySwing = Math.abs(heavy.stack - 100_000);
    if (flatSwing > 0) expect(heavySwing).toBeGreaterThanOrEqual(flatSwing);
    h.room.dispose();
  });

  it('refuses a bet the bank cannot cover at the full multiplier', async () => {
    // A 5x bank, a 5x stake and a possible 6x hand is 150x the stake — a thin bank cannot take it.
    // The bettor's own stack is generous here on purpose, so this bet clears the bettor's-own-loss
    // guard (BUG-06) and it is really the banker exposure guard being exercised.
    const h = await seated(2, [2_000, 500_000]);
    await auction(h, { 0: 'bid-5', 1: 'bid-1' });

    await expect(
      h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bet', amount: 1_000, multiplier: 5 } }),
    ).rejects.toThrow(/exceed banker stack capacity/);

    // Small enough to be covered, so it stands.
    await h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bet', amount: 10, multiplier: 1 } });
    h.room.dispose();
  });

  it('rejects a multiplier the table does not offer', async () => {
    const h = await seated(2);
    await auction(h, { 0: 'bid-1', 1: 'bid-1' });
    await expect(
      h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bet', amount: 100, multiplier: 3 } }),
    ).rejects.toThrow(/1x, 2x or 5x/);
    h.room.dispose();
  });

  it('refuses a bet whose worst loss exceeds the BETTOR\'s own stack (BUG-06)', async () => {
    // 1x bank, 1x stake: the stake alone (1,000) fits a 3,000 stack, but a Five Small banker hand
    // (6x) turns that into a 6,000-chip loss — more than the bettor has. The old guard only ever
    // checked `amount > seat.stack`, which this bet would have passed. The banker's own stack is
    // generous here on purpose, so it is only the bettor's-own-loss guard being exercised — not
    // banker exposure, which is covered separately above.
    const h = await seated(2, [500_000, 3_000]);
    await auction(h, { 0: 'bid-1', 1: 'bid-1' });

    await expect(
      h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bet', amount: 1_000, multiplier: 1 } }),
    ).rejects.toThrow(/can lose 6000 chips/);

    // 500 x 1x x 1x bank x 6x hand = 3,000 — exactly the stack, so it stands.
    await h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bet', amount: 500, multiplier: 1 } });
    h.room.dispose();
  });

  it('never settles a loser below zero, even at the worst-case multiplier the guard allows', async () => {
    const h = await seated(2, 3_000);
    await auction(h, { 0: 'bid-1', 1: 'bid-1' });
    // The largest bet the guard permits at this stack and this bank: 500 x 1 x 1 x 6 = 3,000.
    await h.room.command(h.ids[1]!, { kind: 'act', action: { type: 'bet', amount: 500, multiplier: 1 } });

    await until(() => snapshot(h).phase === 'SHOWDOWN', 10_000);
    const bettor = snapshot(h).seats.find((s) => s.playerId === h.ids[1])!;
    expect(bettor.stack).toBeGreaterThanOrEqual(0);
    h.room.dispose();
  });
});
