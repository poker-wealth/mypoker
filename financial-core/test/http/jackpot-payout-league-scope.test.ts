import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/http/app';
import { Money } from '../../src/domain/money';
import { AccountModel } from '../../src/wallet/account.model';
import { PLATFORM_SCOPE } from '../../src/domain/account-types';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SecurityLogModel } from '../../src/security/security-log.model';
import { SettlementModel } from '../../src/settlement/settlement.model';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import { lockForBuyIn } from '../../src/wallet/seat-funds';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * BUG-16: `/internal/jackpot-payouts` resolved the winner through `getOrCreatePlayerAccount(playerId)`
 * with no scope, which always lands in PLATFORM_SCOPE. But league pools are funded from winners'
 * LEAGUE wallets — table-settlements resolves winners in league scope (routes.ts `playerScope`,
 * ~1200-1206) — so a league jackpot hit paid into the wrong wallet: money left the league pool but
 * never reached the player's league balance, landing in their platform wallet instead.
 *
 * `tableType`/`leagueId` on the payout request route the winner through the same `playerScope` a
 * league buy-in/release/settlement already uses, so a league jackpot pays the SAME account the
 * league's other money movements touch.
 */

const INTERNAL_SECRET = 'test-internal-secret';
let server: Server;
let base: string;

function url(path: string): string {
  return `${base}${path}`;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(url(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
    body: JSON.stringify(body),
  });
}

/** Pre-creates a funded jackpot pool, matching the (accountType, ownerId, scope) shape
 *  `ensureJackpotAccounts` looks for — pools are always PLATFORM-scoped, whichever wallet the
 *  eventual winner is paid into. */
async function seedPool(
  table: string,
  tier: 'mini' | 'minor' | 'major' | 'grand',
  amount: string,
): Promise<string> {
  const accountType = {
    mini: 'JACKPOT_MINI',
    minor: 'JACKPOT_MINOR',
    major: 'JACKPOT_MAJOR',
    grand: 'JACKPOT_GRAND',
  }[tier];
  const pool = await AccountModel.create({
    accountType,
    ownerId: table,
    scope: PLATFORM_SCOPE,
    availableBalance: Money.fromDecimalString(amount).toDecimal128(),
  });
  return pool._id;
}

beforeAll(async () => {
  process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
  await startTestDb();
  await ensureIndexes(AccountModel, LedgerModel, SecurityLogModel, SettlementModel, WithdrawalModel);
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await stopTestDb();
});

afterEach(clearCollections);

describe('a LEAGUE jackpot payout credits the winner\'s league wallet, not their platform one (BUG-16)', () => {
  it('pays a LEAGUE jackpot into the league wallet; the platform wallet for the same playerId is untouched', async () => {
    const TABLE = 'bug16-table';
    const LEAGUE = 'lg-bug16';
    const player = 'bug16-winner';

    // Seed both wallets for the same playerId, so a mistaken PLATFORM credit is visible.
    await AccountModel.create({ accountType: 'PLAYER', ownerId: player, scope: LEAGUE });
    await AccountModel.create({ accountType: 'PLAYER', ownerId: player, scope: PLATFORM_SCOPE });

    const miniPool = await seedPool(TABLE, 'mini', '100');

    const res = await post('/internal/jackpot-payouts', {
      tableId: TABLE,
      tier: 'mini',
      jackpotAccountId: miniPool,
      playerId: player,
      amount: '15',
      roundId: 'bug16-r1',
      tableType: 'LEAGUE',
      leagueId: LEAGUE,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: true });

    const leagueAcct = await AccountModel.findOne({
      accountType: 'PLAYER', ownerId: player, scope: LEAGUE,
    }).lean();
    expect(Money.fromDecimal128(leagueAcct!.availableBalance).toString()).toBe('15.000000');

    const platformAcct = await AccountModel.findOne({
      accountType: 'PLAYER', ownerId: player, scope: PLATFORM_SCOPE,
    }).lean();
    expect(Money.fromDecimal128(platformAcct!.availableBalance).toString()).toBe('0.000000');
  });

  it('a payout with no scope still credits the platform wallet (unscoped callers unchanged)', async () => {
    const TABLE = 'bug16-table-2';
    const player = 'bug16-winner-2';
    const miniPool = await seedPool(TABLE, 'mini', '50');

    const res = await post('/internal/jackpot-payouts', {
      tableId: TABLE,
      tier: 'mini',
      jackpotAccountId: miniPool,
      playerId: player,
      amount: '5',
      roundId: 'bug16-r2',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: true });

    const platformAcct = await AccountModel.findOne({
      accountType: 'PLAYER', ownerId: player, scope: PLATFORM_SCOPE,
    }).lean();
    expect(Money.fromDecimal128(platformAcct!.availableBalance).toString()).toBe('5.000000');
  });
});

/**
 * BUG-23: a jackpot hit is a WALLET credit — `transfer()` moves it into the winner's AVAILABLE
 * balance, same as any other payout, and must never touch a buy-in already sitting in LOCKED. The
 * game-server's play-chip `ChipBank` used to credit locked instead (fixed alongside this test); this
 * pins the real Financial Core route as the reference behaviour both implementations must match.
 */
describe('a jackpot payout credits available and leaves an existing locked buy-in untouched (BUG-23)', () => {
  it('locked stays exactly the buy-in; the jackpot lands in available; a release only unlocks the buy-in', async () => {
    const TABLE = 'bug23-table';
    const player = 'bug23-winner';

    // Seed a wallet with exactly enough to buy in, then lock it all — mirrors a player already
    // seated at a table when the jackpot hits.
    const acct = await AccountModel.create({
      accountType: 'PLAYER',
      ownerId: player,
      scope: PLATFORM_SCOPE,
      availableBalance: Money.fromDecimalString('50').toDecimal128(),
    });
    await lockForBuyIn(acct._id, Money.fromDecimalString('50')); // available 0, locked 50

    const miniPool = await seedPool(TABLE, 'mini', '100');

    const payoutRes = await post('/internal/jackpot-payouts', {
      tableId: TABLE,
      tier: 'mini',
      jackpotAccountId: miniPool,
      playerId: player,
      amount: '15',
      roundId: 'bug23-r1',
    });
    expect(payoutRes.status).toBe(200);
    expect(await payoutRes.json()).toMatchObject({ applied: true });

    const afterPayout = await AccountModel.findOne({
      accountType: 'PLAYER', ownerId: player, scope: PLATFORM_SCOPE,
    }).lean();
    expect(Money.fromDecimal128(afterPayout!.availableBalance).toString()).toBe('15.000000'); // 0 + jackpot
    expect(Money.fromDecimal128(afterPayout!.lockedBalance).toString()).toBe('50.000000'); // untouched buy-in

    const releaseRes = await post('/internal/releases', { playerAccountId: player, amount: '50' });
    expect(releaseRes.status).toBe(200);

    const afterRelease = await AccountModel.findOne({
      accountType: 'PLAYER', ownerId: player, scope: PLATFORM_SCOPE,
    }).lean();
    expect(Money.fromDecimal128(afterRelease!.availableBalance).toString()).toBe('65.000000'); // 15 + released 50
    expect(Money.fromDecimal128(afterRelease!.lockedBalance).toString()).toBe('0.000000');
  });
});
