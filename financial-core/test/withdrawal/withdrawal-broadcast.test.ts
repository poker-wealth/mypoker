import { Decimal128 } from 'bson';
import { AccountModel } from '../../src/wallet/account.model';
import { WithdrawalModel } from '../../src/withdrawal/withdrawal.model';
import { requestWithdrawal, approveWithdrawal } from '../../src/withdrawal/withdrawal-state-machine';
import { signAndBroadcastWithdrawal } from '../../src/withdrawal/withdrawal-broadcast';
import { LocalPrivateKeySigner, type SignerConfig } from '../../src/withdrawal/tron-signer';
import { WithdrawalState } from '../../src/domain/withdrawal-types';
import { Money } from '../../src/domain/money';
import { AccountType } from '../../src/domain/account-types';
import { setAlertHandler, resetAlertHandler, type AlertContext } from '../../src/lib/alert';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * BUG-09: an ambiguous withdrawal broadcast (TronGrid may have accepted the tx and lost the response)
 * must never be treated as "safe to refund" — that is the double-pay. These pin the split between the
 * two failure modes in signAndBroadcastWithdrawal: build/sign failing (nothing reached the chain — roll
 * back) vs. broadcast failing (ambiguous — hold stays, `pendingTxId` blocks a re-send).
 */

const KEY = 'da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0';
const TO_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** A fake TronGrid: triggersmartcontract always succeeds; broadcasttransaction is configurable. */
function fakeFetch(behavior: {
  broadcast: 'ok' | 'throws' | 'rejected';
  txId?: string;
  onBroadcast?: () => void;
}): typeof fetch {
  const txId = behavior.txId ?? 'a'.repeat(64);
  return (async (url: unknown) => {
    const u = String(url);
    if (u.includes('triggersmartcontract')) {
      return {
        ok: true,
        json: async () => ({
          transaction: { txID: txId, raw_data: { expiration: Date.now() + 60_000 }, raw_data_hex: '00' },
        }),
      };
    }
    if (u.includes('broadcasttransaction')) {
      behavior.onBroadcast?.();
      if (behavior.broadcast === 'throws') throw new Error('ETIMEDOUT');
      if (behavior.broadcast === 'rejected') {
        return { ok: true, json: async () => ({ result: false, code: 'SIGERROR' }) };
      }
      return { ok: true, json: async () => ({ result: true, txid: txId }) };
    }
    throw new Error(`unexpected fake-fetch url: ${u}`);
  }) as unknown as typeof fetch;
}

/** A build call that TronGrid itself refuses — nothing ever reaches the chain. */
function fakeFetchBuildFails(): typeof fetch {
  return (async (url: unknown) => {
    const u = String(url);
    if (u.includes('triggersmartcontract')) {
      return { ok: true, json: async () => ({ result: { message: '' } }) };
    }
    throw new Error(`unexpected fake-fetch url: ${u}`);
  }) as unknown as typeof fetch;
}

function cfg(fetchImpl: typeof fetch): SignerConfig {
  return {
    apiUrl: 'https://fake.trongrid.local',
    apiKey: '',
    contractAddress: TO_ADDRESS,
    signer: new LocalPrivateKeySigner(KEY),
    fetchImpl,
  };
}

async function makePlayer(available: string): Promise<string> {
  const a = await AccountModel.create({
    accountType: AccountType.PLAYER,
    ownerId: 'p1',
    availableBalance: Decimal128.fromString(available),
  });
  return a._id;
}

async function balances(id: string): Promise<{ available: number; clearing: number }> {
  const a = await AccountModel.findById(id);
  return {
    available: parseFloat(a!.availableBalance.toString()),
    clearing: parseFloat(a!.clearingBalance.toString()),
  };
}

async function approvedWithdrawal(amount: string): Promise<{ id: string; player: string }> {
  const player = await makePlayer('1000');
  const id = await requestWithdrawal({
    playerAccountId: player,
    amount: Money.fromDecimalString(amount),
    address: TO_ADDRESS,
  });
  await approveWithdrawal(id, 'ops-1');
  return { id, player };
}

describe('signAndBroadcastWithdrawal (BUG-09)', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(AccountModel, WithdrawalModel);
  });
  afterAll(stopTestDb);
  afterEach(async () => {
    await clearCollections();
    resetAlertHandler();
  });

  it('an ambiguous broadcast (throws) keeps the hold, records pendingTxId, and alerts ops — state stays APPROVED', async () => {
    const { id, player } = await approvedWithdrawal('300');
    const alerts: { message: string; context: AlertContext | undefined }[] = [];
    setAlertHandler((message, context) => {
      alerts.push({ message, context });
    });

    await expect(
      signAndBroadcastWithdrawal(id, cfg(fakeFetch({ broadcast: 'throws' }))),
    ).rejects.toThrow();

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.APPROVED);
    expect(w!.pendingTxId).toBe('a'.repeat(64));
    // The clearing hold is untouched either way — no refund, no second movement.
    expect(await balances(player)).toEqual({ available: 700, clearing: 300 });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toMatch(/ambiguous/i);
    expect(alerts[0]!.context).toMatchObject({ withdrawalId: id, txId: 'a'.repeat(64) });
  });

  it('refuses a second send while a broadcast is unresolved', async () => {
    const { id } = await approvedWithdrawal('300');
    await expect(
      signAndBroadcastWithdrawal(id, cfg(fakeFetch({ broadcast: 'throws' }))),
    ).rejects.toThrow();

    // Retry, as the admin's sign-broadcast route would on a second click.
    await expect(
      signAndBroadcastWithdrawal(id, cfg(fakeFetch({ broadcast: 'ok' }))),
    ).rejects.toThrow(/already broadcast/);

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.APPROVED); // still untouched
  });

  it('a build/sign failure is safe to assume-failed — rolls back and returns the funds', async () => {
    const { id, player } = await approvedWithdrawal('250');

    await expect(signAndBroadcastWithdrawal(id, cfg(fakeFetchBuildFails()))).rejects.toThrow();

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.ROLLED_BACK);
    expect(w!.pendingTxId).toBeUndefined();
    expect(await balances(player)).toEqual({ available: 1000, clearing: 0 });
  });

  it('a successful broadcast clears pendingTxId and advances to BROADCASTING with the real txHash', async () => {
    const { id } = await approvedWithdrawal('100');
    const txHash = await signAndBroadcastWithdrawal(id, cfg(fakeFetch({ broadcast: 'ok' })));

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.BROADCASTING);
    expect(w!.txHash).toBe(txHash);
    expect(w!.pendingTxId).toBeUndefined();
  });

  it('two concurrent sends: only one build-and-signs its way to a broadcast', async () => {
    const { id, player } = await approvedWithdrawal('300');
    let broadcastCalls = 0;
    const onBroadcast = (): void => {
      broadcastCalls++;
    };

    const results = await Promise.allSettled([
      signAndBroadcastWithdrawal(id, cfg(fakeFetch({ broadcast: 'ok', txId: 'b'.repeat(64), onBroadcast }))),
      signAndBroadcastWithdrawal(id, cfg(fakeFetch({ broadcast: 'ok', txId: 'c'.repeat(64), onBroadcast }))),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The CAS on pendingTxId stops the loser before it ever calls broadcasttransaction.
    expect(broadcastCalls).toBe(1);

    const w = await WithdrawalModel.findById(id);
    expect(w!.state).toBe(WithdrawalState.BROADCASTING);
    // Held funds moved exactly once — no double clearing/refund from the loser's aborted attempt.
    expect(await balances(player)).toEqual({ available: 700, clearing: 300 });
  });
});
