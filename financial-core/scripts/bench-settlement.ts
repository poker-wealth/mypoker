/**
 * Concurrent settlement latency benchmark (FairPlay M1 acceptance: 50-table concurrent settlement).
 *
 * Measures end-to-end settleRound() wall-clock per settlement under concurrency, and reports the
 * distribution (mean / p50 / p95 / p99 / max). Run:  npx ts-node scripts/bench-settlement.ts
 *
 * Note: numbers are from a single-node in-memory MongoDB on a dev machine — production on a real
 * replica set differs. The shared TREASURY is the contention point (spec Pitfall 1); Phase-2 async
 * rake aggregation removes it at scale.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Decimal128 } from 'bson';
import { connectDb, disconnectDb } from '../src/db/connection';
import { AccountModel } from '../src/wallet/account.model';
import { settleRound } from '../src/settlement/settle-round';
import { TableType } from '../src/settlement/settlement-domain';
import { AccountType } from '../src/domain/account-types';
import { Money } from '../src/domain/money';

const TABLES = 50;
const WARMUP = 5;

interface Table {
  winner: string;
  pools: { mini: string; minor: string; major: string; grand: string };
  roundId: string;
  leagueId?: string;
}

/** `isolated`: each table's rake goes to its own league inventory (no shared hot doc — production
 *  reality with async treasury aggregation). `contended`: all rake hits one shared treasury. */
type Mode = 'isolated' | 'contended';

async function makeTable(mode: Mode, tag: string, i: number): Promise<Table> {
  const winner = await AccountModel.create({
    accountType: AccountType.PLAYER,
    ownerId: `bench-winner-${tag}-${i}`,
    availableBalance: Decimal128.fromString('1000'),
  });
  const pool = async (t: AccountType): Promise<string> =>
    (await AccountModel.create({ accountType: t, ownerId: `bench-table-${tag}-${i}` }))._id;
  const pools = {
    mini: await pool(AccountType.JACKPOT_MINI),
    minor: await pool(AccountType.JACKPOT_MINOR),
    major: await pool(AccountType.JACKPOT_MAJOR),
    grand: await pool(AccountType.JACKPOT_GRAND),
  };
  if (mode === 'isolated') {
    const leagueId = `bench-league-${tag}-${i}`;
    await AccountModel.create({ accountType: AccountType.LEAGUE_INVENTORY, ownerId: leagueId });
    return { winner: winner._id, pools, roundId: `bench-${tag}-${i}`, leagueId };
  }
  return { winner: winner._id, pools, roundId: `bench-${tag}-${i}` };
}

async function settleOne(t: Table): Promise<number> {
  const start = performance.now();
  await settleRound({
    roundId: t.roundId,
    tableType: t.leagueId ? TableType.LEAGUE : TableType.PLATFORM,
    ...(t.leagueId ? { leagueId: t.leagueId } : {}),
    winnerAccountId: t.winner,
    winnerProfit: Money.fromDecimalString('1000'),
    rake: Money.fromDecimalString('50'),
    jackpotAccounts: t.pools,
  });
  return performance.now() - start;
}

function pct(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

const f = (n: number): string => `${n.toFixed(1)}ms`;

function report(label: string, durations: number[], wallTotal: number): void {
  const sorted = [...durations].sort((a, b) => a - b);
  const mean = durations.reduce((s, d) => s + d, 0) / durations.length;
  console.log(`\n=== ${label} ===`);
  console.log(`settlements:          ${durations.length}`);
  console.log(`total wall-clock:     ${f(wallTotal)}`);
  console.log(`throughput:           ${(durations.length / (wallTotal / 1000)).toFixed(1)}/sec`);
  console.log(`per-settlement mean:  ${f(mean)}`);
  console.log(`per-settlement p50:   ${f(pct(sorted, 50))}`);
  console.log(`per-settlement p95:   ${f(pct(sorted, 95))}`);
  console.log(`per-settlement p99:   ${f(pct(sorted, 99))}`);
  console.log(`per-settlement max:   ${f(sorted[sorted.length - 1]!)}`);
  console.log(`per-settlement min:   ${f(sorted[0]!)}`);
}

/** Sequential = true per-settlement service time (no queue wait). The headline latency metric. */
async function runSequential(mode: Mode, tag: string): Promise<void> {
  const tables = await Promise.all(Array.from({ length: TABLES }, (_, i) => makeTable(mode, tag, i)));
  const durations: number[] = [];
  const wallStart = performance.now();
  for (const t of tables) durations.push(await settleOne(t));
  report(`SEQUENTIAL ${mode} — per-settlement latency`, durations, performance.now() - wallStart);
}

/** Concurrent = throughput + contention behaviour. */
async function runConcurrent(mode: Mode, tag: string): Promise<void> {
  const tables = await Promise.all(Array.from({ length: TABLES }, (_, i) => makeTable(mode, tag, i)));
  const wallStart = performance.now();
  const durations = await Promise.all(tables.map(settleOne));
  report(`CONCURRENT ${mode} — throughput`, durations, performance.now() - wallStart);
}

async function main(): Promise<void> {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDb({ uri: rs.getUri('fc_bench') });
  await AccountModel.init();
  await AccountModel.create({ accountType: AccountType.TREASURY, ownerId: 'PLATFORM' });

  // Warm up so first-call driver cost doesn't skew results.
  const warm = await Promise.all(Array.from({ length: WARMUP }, (_, i) => makeTable('isolated', 'warm', i)));
  for (const t of warm) await settleOne(t);

  await runSequential('isolated', 'seq'); // ← the real per-settlement latency
  await runConcurrent('isolated', 'con'); // throughput with async-aggregation-style routing
  await runConcurrent('contended', 'ctd'); // worst case: all rake to one shared treasury (Pitfall 1)

  await disconnectDb();
  await rs.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
