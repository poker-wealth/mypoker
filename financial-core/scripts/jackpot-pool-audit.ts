/**
 * What is sitting in each jackpot pool, and who owns it.
 *
 *   npx ts-node scripts/jackpot-pool-audit.ts
 *
 * Read-only. It moves nothing.
 *
 * Written for the pool-owner fix. The owner was parsed out of the pool id with the wrong index, so
 * every table's pools were created owned by their TIER — "mini", "minor", "major", "grand" —
 * instead of by the table. New pools are created correctly now, but whatever accrued under the old
 * owners is still there, and money does not move as a deploy side effect. This prints the amounts
 * so the migration can be decided and audited rather than guessed at.
 *
 * Point it at whichever database you want counted:
 *   MONGO_URI=... npx ts-node scripts/jackpot-pool-audit.ts
 */
import { connectDb, disconnectDb } from '../src/db/connection';
import { AccountModel } from '../src/wallet/account.model';
import { JACKPOT_ACCOUNT_TYPES } from '../src/domain/account-types';
import { Money } from '../src/domain/money';

/** The tier names that should never appear as an owner — the signature of the old bug. */
const TIER_NAMES = new Set(['mini', 'minor', 'major', 'grand']);

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('Set MONGO_URI to the database you want counted.');
    process.exit(1);
  }

  await connectDb({ uri });

  const accounts = await AccountModel.find({
    accountType: { $in: [...JACKPOT_ACCOUNT_TYPES] },
  }).lean();

  if (accounts.length === 0) {
    console.log('No jackpot accounts in this database.');
    await disconnectDb();
    return;
  }

  const rows = accounts.map((a) => {
    const available = Money.fromDecimal128(a.availableBalance);
    return {
      id: String(a._id),
      type: a.accountType,
      owner: String(a.ownerId),
      scope: a.scope ?? 'PLATFORM',
      amount: available.toString(),
      /** Owned by a tier name means it was created before the fix. */
      stranded: TIER_NAMES.has(String(a.ownerId)),
    };
  });

  const stranded = rows.filter((r) => r.stranded);
  const healthy = rows.filter((r) => !r.stranded);

  const total = (list: typeof rows): string =>
    list
      .reduce((sum, r) => sum.add(Money.fromDecimalString(r.amount)), Money.fromDecimalString('0'))
      .toString();

  console.log('\n── Pools owned by a TIER (created before the fix) ─────────────');
  if (stranded.length === 0) {
    console.log('  none');
  } else {
    for (const r of stranded) {
      console.log(`  ${r.type.padEnd(14)} owner=${r.owner.padEnd(8)} ${r.amount.padStart(14)}  (${r.id})`);
    }
    console.log(`  ${'TOTAL'.padEnd(14)} ${' '.repeat(15)}${total(stranded).padStart(14)}`);
  }

  console.log('\n── Pools owned by a TABLE (created after the fix) ─────────────');
  if (healthy.length === 0) {
    console.log('  none');
  } else {
    for (const r of healthy) {
      console.log(`  ${r.type.padEnd(14)} owner=${r.owner.padEnd(16)} ${r.amount.padStart(14)}`);
    }
    console.log(`  ${'TOTAL'.padEnd(14)} ${' '.repeat(23)}${total(healthy).padStart(14)}`);
  }

  console.log(
    `\n${stranded.length} pool(s) under a tier owner, ${healthy.length} under a table owner.`,
  );
  console.log('Nothing was moved — this only counts.\n');

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('audit failed:', err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
