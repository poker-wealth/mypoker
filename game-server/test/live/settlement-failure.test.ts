import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { NiuNiuRoom } from '../../src/live/niu-niu-room';
import { SanZhangRoom } from '../../src/live/san-zhang-room';

/**
 * A ROUND THAT FAILS TO SETTLE MUST NOT KILL THE TABLE.
 *
 * `resolveRound` runs the settlement, and everything in it can throw: the ledger refusing, a
 * jackpot pool failing to open, a bug. Nothing used to reset `phase`, so the room stayed in IN_HAND
 * for good — players stood up, the seats emptied, and it still reported a hand in progress with
 * nobody to act. Only restarting the process cleared it.
 *
 * That is not hypothetical. A one-line bug in financial-core (jackpot pools created owned by their
 * TIER instead of their table, so the second table to settle hit a duplicate key) took out four
 * tables this way. The bug was small; the blast radius was not, and this is why.
 *
 * So: when settlement throws, the table must come back to WAITING and be able to deal again. It
 * must NOT invent a correction — `fc.settleTableHand` is atomic, so a throw from it means no money
 * moved, and a throw after it means money moved and the mirrored stacks are already right.
 */

const wait = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await wait(5);
  }
  throw new Error('timed out waiting for state');
}

/** A ledger that refuses to settle, the way a real one does when something is wrong. */
class RefusingBank extends ChipBank {
  refuse = true;
  override async settleTableHand(req: Parameters<ChipBank['settleTableHand']>[0]) {
    if (this.refuse) throw new Error('settlement refused by the ledger');
    return super.settleTableHand(req);
  }
}

describe('a failed settlement leaves the table playable', () => {
  it('Niu Niu returns to WAITING instead of wedging in IN_HAND', async () => {
    const players = new DevPlayers({ startingChips: 1_000_000 });
    const bank = new RefusingBank(players);
    const ids = [players.create('A').id, players.create('B').id];

    const room = new NiuNiuRoom(
      {
        id: 'nn-fail',
        name: 'Niu Niu',
        game: 'niu-niu',
        minBuyIn: 1_000,
        maxBuyIn: 500_000,
        maxSeats: 6,
        rakeBps: 500,
        biddingTimeMs: 300,
        bettingTimeMs: 300,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    for (const [i, id] of ids.entries()) {
      await room.command(id, { kind: 'sit', seat: i, buyIn: 100_000 });
    }

    await until(() => room.snapshotFor(ids[0]!).stage === 'BETTING', 10_000);
    const banker = room.snapshotFor(ids[0]!).seats.find((s) => s.isDealer)!.playerId;
    const bettor = ids.find((id) => id !== banker)!;
    await room.command(bettor, { kind: 'act', action: { type: 'bet', amount: 100 } });

    // The settlement throws. Before the fix, the room stopped here forever.
    await until(() => room.snapshotFor(ids[0]!).phase !== 'IN_HAND', 10_000);

    const after = room.snapshotFor(ids[0]!);
    expect(after.phase).not.toBe('IN_HAND');

    // And it is not merely idle — it can deal again once the ledger recovers.
    bank.refuse = false;
    await until(() => room.snapshotFor(ids[0]!).phase === 'IN_HAND', 10_000);

    room.dispose();
  }, 30_000);

  it('San Zhang returns to WAITING instead of wedging in IN_HAND', async () => {
    const players = new DevPlayers({ startingChips: 1_000_000 });
    const bank = new RefusingBank(players);
    const ids = [players.create('A').id, players.create('B').id];

    const room = new SanZhangRoom(
      {
        id: 'sz-fail',
        name: 'San Zhang',
        game: 'san-zhang',
        minBuyIn: 1_000,
        maxBuyIn: 500_000,
        maxSeats: 6,
        rakeBps: 500,
        bettingTimeMs: 300,
        showdownDelayMs: 20,
      },
      { directory: players, fc: bank },
    );

    for (const [i, id] of ids.entries()) {
      await room.command(id, { kind: 'sit', seat: i, buyIn: 100_000 });
    }

    await until(() => room.snapshotFor(ids[0]!).phase === 'IN_HAND', 10_000);
    const banker = room.snapshotFor(ids[0]!).seats.find((s) => s.isDealer)!.playerId;
    const bettor = ids.find((id) => id !== banker)!;
    await room.command(bettor, { kind: 'act', action: { type: 'bet', amount: 100 } });

    await until(() => room.snapshotFor(ids[0]!).phase !== 'IN_HAND', 10_000);
    expect(room.snapshotFor(ids[0]!).phase).not.toBe('IN_HAND');

    room.dispose();
  }, 30_000);
});
