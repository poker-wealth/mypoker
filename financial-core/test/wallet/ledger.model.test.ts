import { Decimal128 } from 'bson';
import { LedgerModel } from '../../src/wallet/ledger.model';
import { LedgerType, LedgerDirection, LedgerStatus } from '../../src/domain/account-types';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

const d = (v: string): Decimal128 => Decimal128.fromString(v);

/** Write the matched DEBIT+CREDIT pair for one transfer (what transfer() will do in a txn). */
async function writePair(opts: {
  idempotencyKey: string;
  from: string;
  to: string;
  amount: string;
  type: LedgerType;
}): Promise<void> {
  await LedgerModel.create([
    {
      idempotencyKey: opts.idempotencyKey,
      accountId: opts.from,
      counterpartyAccountId: opts.to,
      direction: LedgerDirection.DEBIT,
      amount: d(opts.amount),
      type: opts.type,
    },
    {
      idempotencyKey: opts.idempotencyKey,
      accountId: opts.to,
      counterpartyAccountId: opts.from,
      direction: LedgerDirection.CREDIT,
      amount: d(opts.amount),
      type: opts.type,
    },
  ]);
}

describe('ledger model (double-entry)', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes(LedgerModel);
  });
  afterAll(stopTestDb);
  afterEach(clearCollections);

  it('defaults status to SETTLED and stamps createdAt only (entries are immutable)', async () => {
    const [entry] = await LedgerModel.create([
      {
        idempotencyKey: 'k1',
        accountId: 'a',
        counterpartyAccountId: 'b',
        direction: LedgerDirection.DEBIT,
        amount: d('10'),
        type: LedgerType.DEPOSIT,
      },
    ]);
    expect(entry!.status).toBe(LedgerStatus.SETTLED);
    expect(entry!.createdAt).toBeInstanceOf(Date);
    expect((entry as unknown as { updatedAt?: Date }).updatedAt).toBeUndefined();
  });

  it('rejects a non-positive amount (sign is carried by direction, never the number)', async () => {
    await expect(
      LedgerModel.create([
        {
          idempotencyKey: 'k-neg',
          accountId: 'a',
          counterpartyAccountId: 'b',
          direction: LedgerDirection.DEBIT,
          amount: d('0'),
          type: LedgerType.DEPOSIT,
        },
      ]),
    ).rejects.toThrow(/amount must be > 0/);
  });

  it('prevents double-insert of the same transfer (unique idempotencyKey+direction)', async () => {
    await writePair({ idempotencyKey: 'dup', from: 'a', to: 'b', amount: '50', type: LedgerType.RAKE });
    await expect(
      writePair({ idempotencyKey: 'dup', from: 'a', to: 'b', amount: '50', type: LedgerType.RAKE }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('records a transfer as a matched DEBIT + CREDIT pair sharing one key', async () => {
    await writePair({ idempotencyKey: 'k2', from: 'a', to: 'b', amount: '25', type: LedgerType.WIN_PAYOUT });
    const pair = await LedgerModel.find({ idempotencyKey: 'k2' }).sort({ direction: 1 });
    expect(pair).toHaveLength(2);
    const debit = pair.find((e) => e.direction === LedgerDirection.DEBIT)!;
    const credit = pair.find((e) => e.direction === LedgerDirection.CREDIT)!;
    expect(debit.accountId).toBe('a');
    expect(credit.accountId).toBe('b');
    expect(debit.amount.toString()).toBe(credit.amount.toString());
  });

  it('upholds the system invariant Σ(DEBIT) = Σ(CREDIT) across many transfers', async () => {
    await writePair({ idempotencyKey: 't1', from: 'a', to: 'b', amount: '10', type: LedgerType.BET });
    await writePair({ idempotencyKey: 't2', from: 'b', to: 'c', amount: '3.5', type: LedgerType.RAKE });
    await writePair({ idempotencyKey: 't3', from: 'a', to: 'c', amount: '7.25', type: LedgerType.WIN_PAYOUT });

    const agg = await LedgerModel.aggregate<{ _id: LedgerDirection; total: string }>([
      { $group: { _id: '$direction', total: { $sum: '$amount' } } },
    ]);
    const totals = Object.fromEntries(agg.map((r) => [r._id, r.total.toString()]));
    expect(totals[LedgerDirection.DEBIT]).toBe(totals[LedgerDirection.CREDIT]);
  });
});
