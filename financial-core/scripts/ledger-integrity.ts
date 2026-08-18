import mongoose from 'mongoose';
import { AccountModel } from '../src/wallet/account.model';
import { LedgerModel } from '../src/wallet/ledger.model';
import { LedgerDirection, LedgerStatus } from '../src/domain/account-types';

/**
 * Gate 1 of docs/LAUNCH-QA.md — ledger integrity, made runnable.
 *
 *   MONGO_URI=<uri> [MONGO_TLS=false] npx ts-node scripts/ledger-integrity.ts
 *
 * The spec's hardest launch gate is one sentence: "sum of all Ledger entries per
 * account = current account balance. Zero discrepancy." Nobody hand-sums a
 * ledger, so without this the box gets ticked on faith. This performs it.
 *
 * FOUR INVARIANTS, catching different failures:
 *
 *   PER ACCOUNT     Σ(credits) − Σ(debits) == available + locked + clearing.
 *                   Catches a balance moved without a ledger entry, or an entry
 *                   written without the balance moving.
 *
 *   PAIRED DOUBLE   a transfer's entries share an idempotency key and must be a
 *   ENTRY           balanced pair — money that left one account and arrived
 *                   nowhere is a half-written transfer.
 *
 *   POT             table settlements deliberately do NOT write pairs: each leg
 *   CONSERVATION    (loss / win / rake / jackpot) is a single entry against a
 *                   virtual `pot:<roundId>` counterparty that has no account of
 *                   its own. Their invariant is conservation per pot: what the
 *                   losers paid in equals what winners + rake + jackpot took
 *                   out. An earlier version of this script wrongly held these
 *                   to the pair rule and FAILED every healthy system that had
 *                   settled a single hand — a gate that fails healthy systems
 *                   trains people to ignore it, which is worse than no gate.
 *
 *   SYSTEM-WIDE     Σ(all balances) == 0. EXTERNAL is the only mint: real money
 *                   entering is a negative there and a positive on a player.
 *                   Non-zero total = value created or destroyed internally.
 *
 * Plus an ORPHAN check: ledger rows naming an account that does not exist are
 * reported — the per-account loop alone would silently skip them.
 *
 * Reads only. Exit 0 = zero discrepancy, 1 = discrepancies found, 2 = could not
 * run. All arithmetic in integer micro-units via BigInt — never a float: a
 * rounding error introduced by the CHECKER would be indistinguishable from a
 * real discrepancy. `dec()` is strict: a value it does not recognise (exponent
 * notation, empty string, garbage) is itself reported as a finding rather than
 * silently parsed as something else — an earlier version parsed
 * "9.99…E+28" as ₮9.99, which is exactly how a checker lies.
 */

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

interface Dec {
  v: bigint;
  /** False when digits beyond 6dp were truncated — legitimate writers never
   *  produce them, so imprecision is itself suspicious and gets reported. */
  exact: boolean;
}

const dec = (raw: unknown, where: string, problems: string[]): Dec => {
  const s = String(raw ?? '0');
  if (!DECIMAL_RE.test(s)) {
    problems.push(`${where}: unparseable amount ${JSON.stringify(s)} — refusing to guess`);
    return { v: 0n, exact: false };
  }
  const neg = s.startsWith('-');
  const [whole = '0', frac = ''] = (neg ? s.slice(1) : s).split('.');
  const micros = BigInt(whole) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
  const exact = frac.length <= 6 || /^0*$/.test(frac.slice(6));
  if (!exact) {
    problems.push(`${where}: ${s} carries sub-micro precision — no legitimate writer produces this`);
  }
  return { v: neg ? -micros : micros, exact };
};

const fmt = (micros: bigint): string => {
  const neg = micros < 0n;
  const a = neg ? -micros : micros;
  return `${neg ? '-' : ''}${a / 1_000_000n}.${String(a % 1_000_000n).padStart(6, '0')}`;
};

async function run(problems: string[]): Promise<{ accounts: number; entries: number; pending: number; systemTotal: bigint }> {
  // ── 1. Per account ────────────────────────────────────────────────────────
  const accounts = await AccountModel.find().lean();
  const accountIds = new Set(accounts.map((a) => a._id));

  const sums = await LedgerModel.aggregate<{ _id: { a: string | null; d: string }; total: unknown; n: number }>([
    { $match: { status: { $ne: LedgerStatus.PENDING } } },
    {
      $group: {
        _id: { a: '$accountId', d: '$direction' },
        total: { $sum: { $toDecimal: '$amount' } },
        n: { $sum: 1 },
      },
    },
  ]);

  const byAccount = new Map<string, { credit: bigint; debit: bigint }>();
  for (const row of sums) {
    const id = row._id.a;
    // ORPHANS: ledger rows naming no account, or an account that does not
    // exist. The per-account loop below iterates ACCOUNTS, so without this
    // check these rows would simply never be compared to anything.
    if (id === null || id === undefined || !accountIds.has(id)) {
      problems.push(
        `ledger names account ${JSON.stringify(id)} (${row.n} entr${row.n === 1 ? 'y' : 'ies'}) which does not exist`,
      );
      continue;
    }
    const cur = byAccount.get(id) ?? { credit: 0n, debit: 0n };
    const total = dec(row.total, `ledger sum for ${id}/${row._id.d}`, problems).v;
    if (row._id.d === LedgerDirection.CREDIT) cur.credit += total;
    else cur.debit += total;
    byAccount.set(id, cur);
  }

  let systemTotal = 0n;
  for (const acc of accounts) {
    const balance =
      dec(acc.availableBalance, `account ${acc._id} available`, problems).v +
      dec(acc.lockedBalance, `account ${acc._id} locked`, problems).v +
      dec(acc.clearingBalance, `account ${acc._id} clearing`, problems).v;
    systemTotal += balance;

    const { credit = 0n, debit = 0n } = byAccount.get(acc._id) ?? {};
    const fromLedger = credit - debit;
    if (fromLedger !== balance) {
      problems.push(
        `account ${acc._id} (${acc.accountType}): balance ${fmt(balance)} but ledger says ${fmt(fromLedger)} — off by ${fmt(balance - fromLedger)}`,
      );
    }
  }

  // ── 2. Paired double entry (everything EXCEPT settlement pot legs) ────────
  const unpaired = await LedgerModel.aggregate<{ _id: string; n: number; net: unknown }>([
    {
      $match: {
        status: { $ne: LedgerStatus.PENDING },
        counterpartyAccountId: { $not: /^pot:/ },
      },
    },
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
      `idempotency key ${u._id}: ${u.n} entr${u.n === 1 ? 'y' : 'ies'}, net ${fmt(dec(u.net, `pair net for ${u._id}`, problems).v)} — a transfer must be a balanced pair`,
    );
  }

  // ── 3. Pot conservation (settlement legs) ─────────────────────────────────
  // Each settled hand writes single entries against `pot:<roundId>`: losers
  // DEBIT (money into the pot), winners/rake/jackpot CREDIT (money out of it).
  // The pot itself is virtual, so the check is that it empties exactly.
  const pots = await LedgerModel.aggregate<{ _id: string; n: number; net: unknown }>([
    {
      $match: {
        status: { $ne: LedgerStatus.PENDING },
        counterpartyAccountId: /^pot:/,
      },
    },
    {
      $group: {
        _id: '$counterpartyAccountId',
        n: { $sum: 1 },
        net: {
          $sum: {
            $cond: [
              { $eq: ['$direction', LedgerDirection.DEBIT] },
              { $toDecimal: '$amount' },
              { $multiply: [{ $toDecimal: '$amount' }, -1] },
            ],
          },
        },
      },
    },
    { $match: { net: { $ne: 0 } } },
    { $limit: 50 },
  ]);
  for (const p of pots) {
    problems.push(
      `${p._id}: ${p.n} legs, imbalance ${fmt(dec(p.net, `pot net for ${p._id}`, problems).v)} — losses must equal wins + rake + jackpot`,
    );
  }

  // ── 4. System-wide ────────────────────────────────────────────────────────
  if (systemTotal !== 0n) {
    problems.push(
      `system total is ${fmt(systemTotal)}, not zero — value was created or destroyed inside the platform`,
    );
  }

  const pending = await LedgerModel.countDocuments({ status: LedgerStatus.PENDING });
  const entries = await LedgerModel.countDocuments();
  return { accounts: accounts.length, entries, pending, systemTotal };
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is required');
  // MONGO_TLS=false for a local/dev mongod; TLS stays the default otherwise.
  await mongoose.connect(uri, { tls: process.env.MONGO_TLS !== 'false' } as never);

  const problems: string[] = [];
  try {
    const s = await run(problems);
    console.log(`  accounts checked:     ${s.accounts}`);
    console.log(`  ledger entries:       ${s.entries}`);
    console.log(`  pending (excluded):   ${s.pending}`);
    console.log(`  system total:         ${fmt(s.systemTotal)}`);
    console.log('');

    if (problems.length === 0) {
      console.log('  LEDGER INTEGRITY: PASS — zero discrepancy.');
      process.exitCode = 0;
    } else {
      console.log(`  LEDGER INTEGRITY: FAIL — ${problems.length} discrepanc${problems.length === 1 ? 'y' : 'ies'}:`);
      for (const p of problems) console.log(`    - ${p}`);
      process.exitCode = 1;
    }
  } finally {
    // Always disconnect: an open connection keeps the event loop alive, and an
    // earlier version of this script would HANG on any post-connect error —
    // exitCode 2 set but never delivered, which in CI reads as a timeout, not
    // a verdict.
    await mongoose.disconnect();
  }
}

void main().catch(async (err) => {
  console.error('  ledger integrity check could not run:', err);
  process.exitCode = 2;
  await mongoose.disconnect().catch(() => {});
});
