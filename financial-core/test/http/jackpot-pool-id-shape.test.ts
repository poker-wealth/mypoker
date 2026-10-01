import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Decimal128 } from 'bson';
import { createApp } from '../../src/http/app';
import { Money } from '../../src/domain/money';
import { AccountModel } from '../../src/wallet/account.model';
import { PLATFORM_SCOPE } from '../../src/domain/account-types';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { SecurityLogModel } from '../../src/security/security-log.model';
import { SettlementModel } from '../../src/settlement/settlement.model';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * BUG-05: jackpot pool accounts must be reused whatever id shape the caller names them with.
 *
 * The game server disagrees with itself about a pool id's shape: base-room.ts (every non-poker
 * game) names pools `jp:<tier>:<table>`; poker-room.ts names them `jp:<table>:<tier>`. And
 * routes.ts's own `/internal/jackpot-payouts` handler guesses a THIRD thing — it pre-provisions the
 * three tiers it is NOT paying this round as `jp:<table>:<tier>`, regardless of which shape the
 * caller actually uses for real. `ensureJackpotAccounts` used to upsert by `_id`, so a second call
 * naming the same real (accountType, ownerId, scope) account under a different `_id` string tried to
 * INSERT a second document — which the unique (accountType, ownerId, scope) index refuses with
 * E11000, taking the whole `Promise.all` (every tier, not just the mismatched one) down as a 500.
 * A base-room game's FIRST jackpot payout ever attempted therefore always 500'd, because its own
 * settlement had already created the real accounts, and the payout route's sibling-tier fallback
 * immediately collided with them.
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

describe('jackpot pool accounts survive an id-shape mismatch between callers (BUG-05)', () => {
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

  it('a table-settlement followed by a jackpot-payout in a different tier does not 500 (base-room pool shape)', async () => {
    const TABLE = 'bug05-table';
    // base-room.tableJackpotAccounts shape: jp:<tier>:<table>.
    const pools = {
      mini: `jp:mini:${TABLE}`,
      minor: `jp:minor:${TABLE}`,
      major: `jp:major:${TABLE}`,
      grand: `jp:grand:${TABLE}`,
    };

    await AccountModel.create({
      accountType: 'PLAYER',
      ownerId: 'bug05-loser',
      lockedBalance: Decimal128.fromString('1000'),
    });
    await AccountModel.create({ accountType: 'PLAYER', ownerId: 'bug05-winner' });

    // Settlement creates all four real pools under the tier:table shape, and injects $5 into mini.
    const settleRes = await post('/internal/table-settlements', {
      roundId: 'bug05-r1',
      tableType: 'PLATFORM',
      losers: [{ playerAccountId: 'bug05-loser', amount: '1000' }],
      winners: [{ playerAccountId: 'bug05-winner', amount: '945' }],
      rake: '50',
      jackpot: { mini: '5', minor: '0', major: '0', grand: '0' },
      jackpotAccounts: pools,
    });
    expect(settleRes.status).toBe(200);
    expect(await settleRes.json()).toMatchObject({ applied: true });

    // Exactly four pool accounts exist, at the real ids the room used.
    expect(await AccountModel.countDocuments({ ownerId: TABLE })).toBe(4);
    const miniPoolBefore = await AccountModel.findById(pools.mini).lean();
    expect(miniPoolBefore).not.toBeNull();

    // The jackpot-payout route ensures the OTHER three tiers under its own guessed
    // `jp:<table>:<tier>` shape — a different _id than the real ones settlement just created for
    // minor/major/grand. Before the fix, this collided with the unique index and 500'd the whole
    // request, even though the tier actually being paid (mini) had the correct id.
    const payoutRes = await post('/internal/jackpot-payouts', {
      tableId: TABLE,
      tier: 'mini',
      jackpotAccountId: pools.mini,
      playerId: 'bug05-jackpot-winner',
      amount: '3',
      roundId: 'bug05-r1',
    });
    expect(payoutRes.status).toBe(200);
    expect(await payoutRes.json()).toMatchObject({ applied: true });

    // No phantom accounts from the mismatched fallback shape — still exactly four for this table.
    expect(await AccountModel.countDocuments({ ownerId: TABLE })).toBe(4);

    // The pool debited and the player credited, through the same real mini account.
    const miniPoolAfter = await AccountModel.findById(pools.mini).lean();
    expect(Money.fromDecimal128(miniPoolAfter!.availableBalance).toString()).toBe('2.000000');
    const winner = await AccountModel.findOne({
      accountType: 'PLAYER',
      ownerId: 'bug05-jackpot-winner',
      scope: PLATFORM_SCOPE,
    }).lean();
    expect(Money.fromDecimal128(winner!.availableBalance).toString()).toBe('3.000000');
  });
});
