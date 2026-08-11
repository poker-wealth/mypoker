/**
 * Live smoke test for the real-money rail (Day 1).
 *
 * Exercises the ACTUAL rail classes against a running Financial Core: chips → USDT conversion
 * (ChipDenominatedFc), the real ledger lock/unlock (buyIn/release), and the balance read
 * (FcPlayerDirectory + the new /internal/accounts/:id/balance endpoint). Non-destructive: it buys in
 * and releases the same amount, so the player's balance is restored exactly.
 *
 *   npx ts-node scripts/smoke-rail.ts <fcBaseUrl> <internalSecret> <playerId> [chips]
 */
import { HttpFinancialCoreClient } from '../src/core/financial-core-client';
import { ChipDenominatedFc } from '../src/live/fc-chip-adapter';
import { FcPlayerDirectory } from '../src/live/fc-directory';

async function main(): Promise<void> {
  const [, , baseUrlArg, secret, player, chipsArg] = process.argv;
  if (!baseUrlArg || !secret || !player) {
    throw new Error('usage: smoke-rail.ts <fcBaseUrl> <internalSecret> <playerId> [chips]');
  }
  const chips = chipsArg ?? '2000';
  const apiBase = `${baseUrlArg.replace(/\/$/, '')}/api/v1`;
  const fc = new ChipDenominatedFc(new HttpFinancialCoreClient({ baseUrl: apiBase, internalSecret: secret }));
  const dir = new FcPlayerDirectory({ baseUrl: apiBase, internalSecret: secret });

  const show = (n: number): string => `${n} chips (₮${(n / 100).toFixed(2)})`;

  const before = await dir.availableChips(player);
  console.log(`available before        : ${show(before)}`);

  await fc.buyIn(player, chips);
  const afterBuyIn = await dir.availableChips(player);
  console.log(`available after buyIn ${chips}: ${show(afterBuyIn)}  (expected ${show(before - Number(chips))})`);
  if (afterBuyIn !== before - Number(chips)) throw new Error('buyIn locked the wrong amount');

  await fc.release(player, chips);
  const afterRelease = await dir.availableChips(player);
  console.log(`available after release : ${show(afterRelease)}  (expected ${show(before)})`);
  if (afterRelease !== before) throw new Error('release did not restore the balance');

  console.log('\n✅ RAIL SMOKE PASS — chips→USDT→real ledger lock/unlock round-trips exactly; balance restored.');
}

main().catch((err) => {
  console.error('\n❌ RAIL SMOKE FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
