import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import type { TableSettlementRequest } from '../../src/core/financial-core-client';

/**
 * BUG-23: `ChipBank.jackpotPayout` used to call `ledger.adjustLocked`, so on the play-money server
 * a jackpot hit landed in the winner's LOCKED balance — the table stack, not the wallet. That
 * mismatched the real Financial Core, whose `/internal/jackpot-payouts` route pays through
 * `transfer()` into the winner's AVAILABLE balance (a wallet credit). A jackpot sitting in locked
 * only unlocks on `stand`, and only up to `seat.stack` (which never grew to include it) — so the
 * chips stayed locked forever. Fixed by routing the payout through the new `ChipLedger.credit`,
 * the play-chip mirror of FC's `transfer()`.
 */

const ACCOUNTS = { mini: 'jp:t1:mini', minor: 'jp:t1:minor', major: 'jp:t1:major', grand: 'jp:t1:grand' };

/** Seeds a jackpot pool the same way a real settlement would: a hand's jackpot cut lands in the
 *  sink via `settleTableHand`, with no losers/winners so it does not disturb any player's chips. */
async function seedPool(bank: ChipBank, roundId: string, tier: keyof typeof ACCOUNTS, amount: string): Promise<void> {
  const jackpot: TableSettlementRequest['jackpot'] = { mini: '0', minor: '0', major: '0', grand: '0' };
  jackpot[tier] = amount;
  await bank.settleTableHand({
    roundId,
    tableType: 'PLATFORM',
    losers: [],
    winners: [],
    rake: '0',
    jackpot,
    jackpotAccounts: ACCOUNTS,
  });
}

describe('ChipBank.jackpotPayout — pays into the wallet, not locked (BUG-23)', () => {
  it('credits AVAILABLE, leaves LOCKED untouched, and conserves total chips', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    players.lock(alice, 2_000); // a seated stack
    await seedPool(bank, 'seed-mini', 'mini', '100');

    const totalBefore = players.totalChips() + bank.sinkTotal();

    const result = await bank.jackpotPayout({
      roundId: 'r1',
      tier: 'mini',
      playerId: alice,
      amount: '5',
      jackpotAccountId: ACCOUNTS.mini,
      tableId: 't1',
    });

    expect(result.applied).toBe(true);
    expect(players.available(alice)).toBe(8_005); // 10_000 - 2_000 (locked) + 5 (jackpot)
    expect(players.locked(alice)).toBe(2_000); // untouched — the stack mirror is unaffected
    expect(bank.sinkBalances()[ACCOUNTS.mini]).toBe(95);
    expect(players.totalChips() + bank.sinkTotal()).toBe(totalBefore); // conservation

    // A replay of the same round+tier key moves nothing.
    const before = { available: players.available(alice), locked: players.locked(alice), sink: bank.sinkBalances()[ACCOUNTS.mini] };
    const replay = await bank.jackpotPayout({
      roundId: 'r1',
      tier: 'mini',
      playerId: alice,
      amount: '5',
      jackpotAccountId: ACCOUNTS.mini,
      tableId: 't1',
    });
    expect(replay.applied).toBe(false);
    expect(players.available(alice)).toBe(before.available);
    expect(players.locked(alice)).toBe(before.locked);
    expect(bank.sinkBalances()[ACCOUNTS.mini]).toBe(before.sink);
  });

  it('refuses a payout the pool cannot cover, and moves nothing', async () => {
    const players = new DevPlayers({ startingChips: 10_000 });
    const bank = new ChipBank(players);
    const alice = players.create('Alice').id;

    players.lock(alice, 2_000);
    await seedPool(bank, 'seed-minor', 'minor', '3'); // pool holds 3, payout asks for 5

    const before = {
      available: players.available(alice),
      locked: players.locked(alice),
      sink: bank.sinkBalances()[ACCOUNTS.minor],
    };

    await expect(
      bank.jackpotPayout({
        roundId: 'r2',
        tier: 'minor',
        playerId: alice,
        amount: '5',
        jackpotAccountId: ACCOUNTS.minor,
        tableId: 't1',
      }),
    ).rejects.toThrow(/holds 3, cannot pay 5/);

    expect(players.available(alice)).toBe(before.available);
    expect(players.locked(alice)).toBe(before.locked);
    expect(bank.sinkBalances()[ACCOUNTS.minor]).toBe(before.sink);
  });
});
