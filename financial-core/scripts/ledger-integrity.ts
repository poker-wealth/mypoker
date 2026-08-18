import mongoose from 'mongoose';
import { AccountModel } from '../src/wallet/account.model';
import { LedgerModel } from '../src/wallet/ledger.model';
import { LedgerDirection, LedgerStatus } from '../src/domain/account-types';

/**
 * Gate 1 of docs/LAUNCH-QA.md — ledger integrity, made runnable.
 *
 *   npx ts-node scripts/ledger-integrity.ts
 *
 * The spec's hardest launch gate is one sentence: "sum of all Ledger entries per
 * account = current account balance. Zero discrepancy." It sat in the checklist
 * marked MANUAL with no way to actually perform it, which is the same as not
 * having the gate — nobody hand-sums a ledger, so the box would get ticked on
 * faith. This performs it.
 *
 * THREE INVARIANTS, and they catch different failures:
 *
 *   PER ACCOUNT   Σ(credits) − Σ(debits) == the three balances added together.
 *                 Catches a balance moved without a ledger entry, or an entry
 *                 written without the balance moving.
 *
 *   DOUBLE ENTRY  every entry has a counterparty entry of the same amount and
 *                 the opposite direction, sharing an idempotency key. Catches a
 *                 half-written transfer — money that left one account and
 *                 arrived nowhere.
 *
 *   SYSTEM-WIDE   Σ(all balances) == 0. The EXTERNAL account is the mint: real
 *                 money entering shows as a negative there and a positive in a
 *                 player account. A non-zero total means value was created or
 *                 destroyed inside the platform.
 *
 * Reads only. Exits non-zero on any discrepancy so CI or a launch runbook can
 * gate on it. PENDING entries are excluded from the balance comparison — they
 * are recorded but deliberately not reflected in a balance yet — and reported
 * separately so a large pending pile does not hide behind a green result.
 */

const dec = (v: unknown): bigint => {
  // Decimal128 → integer micro-units, via string. Never through a float: a
  // rounding error introduced by the CHECKER would be indistinguishable from a
  // real discrepancy, which would make this tool worse than useless.
  const s = String(v ?? '0');
  const neg = s.startsWith('-');
  const [whole = '0', frac = ''] = (neg ? s.slice(1) : s).split('.');
  const micros = BigInt(whole) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
  return neg ? -micros : micros;
};

const fmt = (micros: bigint): string => {
  const neg = micros < 0n;
  const a = neg ? -micros : micros;
  return `${neg ? '-' : ''}${a / 1_000_000n}.${String(a % 1_000_000n).padStart(6, '0')}`;
};

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is required');
  await mongoose.connect(uri, { tls: process.env.MONGO_TLS !== 'false' } as never);

  const problems: string[] = [];

  // ── 1. Per account ────────────────────────────────────────────────────────
  const accounts = await AccountModel.find().lean();
  const sums = await LedgerModel.aggregate<{ _id: { a: string; d: string }; total: string }>([
    { $match: { status: { $ne: LedgerStatus.PENDING } } },
    { $group: { _id: { a: '$accountId', d: '$direction' }, total: { $sum: { $toDecimal: '$amount' } } } },
  ]);

  const byAccount = new Map<string, { credit: bigint; debit: bigint }>();
  for (const row of sums) {
    const cur = byAccount.get(row._id.a) ?? { credit: 0n, debit: 0n };
    if (row._id.d === LedgerDirection.CREDIT) cur.credit += dec(row.total);
    else cur.debit += dec(row.total);
    byAccount.set(row._id.a, cur);
  }

  let systemTotal = 0n;
  for (const acc of accounts) {
    const balance =
      dec(acc.availableBalance) + dec(acc.lockedBalance) + dec(acc.clearingBalance);
    systemTotal += balance;

    const { credit = 0n, debit = 0n } = byAccount.get(acc._id) ?? {};
    const fromLedger = credit - debit;
    if (fromLedger !== balance) {
      problems.push(
        `account ${acc._id} (${acc.accountType}): balance ${fmt(balance)} but ledger says ${fmt(fromLedger)} — off by ${fmt(balance - fromLedger)}`,
      );
    }
  }

  // ── 2. Double entry ───────────────────────────────────────────────────────
  const unpaired = await LedgerModel.aggregate<{ _id: string; n: number; net: string }>([
    { $match: { status: { $ne: LedgerStatus.PENDING } } },
    {
      $group: {
        _id: '$idempotencyKey',
        n: { $sum: 1 },
        net: {
          $sum: {
            $cond: [
              { $eq: ['$direction', LedgerDirection.CREDIT] },
              { $toDecimal: '$amount' },
              { $multiply: [{ $toDecimal: '$amount' }, -1] },
            ],
          },
        },
      },
    },
    { $match: { $or: [{ n: { $lt: 2 } }, { net: { $ne: 0 } }] } },
    { $limit: 50 },
  ]);
  for (const u of unpaired) {
    problems.push(
      `idempotency key ${u._id}: ${u.n} entr${u.n === 1 ? 'y' : 'ies'}, net ${fmt(dec(u.net))} — a transfer must be a balanced pair`,
    );
  }

  // ── 3. System-wide ────────────────────────────────────────────────────────
  if (systemTotal !== 0n) {
    problems.push(
      `system total is ${fmt(systemTotal)}, not zero — value was created or destroyed inside the platform`,
    );
  }

  const pending = await LedgerModel.countDocuments({ status: LedgerStatus.PENDING });

  console.log(`  accounts checked:     ${accounts.length}`);
  console.log(`  ledger entries:       ${await LedgerModel.countDocuments()}`);
  console.log(`  pending (excluded):   ${pending}`);
  console.log(`  system total:         ${fmt(systemTotal)}`);
  console.log('');

  if (problems.length === 0) {
    console.log('  LEDGER INTEGRITY: PASS — zero discrepancy.');
  } else {
    console.log(`  LEDGER INTEGRITY: FAIL — ${problems.length} discrepanc${problems.length === 1 ? 'y' : 'ies'}:`);
    for (const p of problems) console.log(`    - ${p}`);
  }

  await mongoose.disconnect();
  process.exitCode = problems.length === 0 ? 0 : 1;
}

void main().catch((err) => {
  console.error('  ledger integrity check could not run:', err);
  process.exitCode = 2;
});
