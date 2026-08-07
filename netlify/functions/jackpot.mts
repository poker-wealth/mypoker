import { seedLobby } from '../../game-server/src/lobby';
import { TIERS, TIER_CONFIG, GRAND_WINDOW } from '../../game-server/src/jackpot/tiers';
import { grandWindow, isInGrandWindow } from '../../game-server/src/jackpot/schedule';
import type { JackpotTier } from '../../game-server/src/jackpot/tiers';

/**
 * GET /jackpot — pool sizes per tier, plus the Grand window.
 *
 * Serverless for the same reason and with the same expiry date as the lobby
 * function: the pools are derived from a static table seed today, so a function
 * returns exactly what the running gateway returns. Once the game loop owns live
 * pools this has to move to the gateway — an accruing jackpot cannot be
 * reconstructed per request.
 *
 * Deliberately duplicates no arithmetic: tiers, thresholds, injection split and
 * window all come from game-server/src/jackpot, which is the same module the
 * engine settles against. A second copy of the 20/30/25/25 split would be a
 * second answer to how much money is in a pool.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Short cache: pools move on settlement, not on the second.
      'cache-control': 'public, max-age=10',
    },
  });

export default async (_req: Request): Promise<Response> => {
  const lobby = seedLobby();
  const now = Date.now();
  const window = grandWindow(now);

  // Split each table's pool by the same 20/30/25/25 the injection uses, so the
  // tiers shown always sum to the total the lobby reports for the same tables.
  const totals: Record<JackpotTier, number> = { MINI: 0, MINOR: 0, MAJOR: 0, GRAND: 0 };
  for (const table of lobby.listTables()) {
    for (const tier of TIERS) {
      totals[tier] += Math.floor((table.jackpot * TIER_CONFIG[tier].injectionBps) / 10000);
    }
  }

  const tiers = TIERS.map((tier) => {
    const config = TIER_CONFIG[tier];
    return {
      tier,
      amount: totals[tier],
      minThreshold: config.minThreshold,
      armed: totals[tier] >= config.minThreshold,
      payoutBps: config.payoutBps,
      injectionBps: config.injectionBps,
      cadence: config.cadence.kind,
    };
  });

  return json({
    tiers,
    total: tiers.reduce((sum, t) => sum + t.amount, 0),
    grand: {
      open: isInGrandWindow(now),
      opensAt: new Date(window.start).toISOString(),
      closesAt: new Date(window.end).toISOString(),
      timezoneOffsetHours: GRAND_WINDOW.timezoneOffsetHours,
      weekday: GRAND_WINDOW.weekday,
      startHour: GRAND_WINDOW.startHour,
      endHour: GRAND_WINDOW.endHour,
    },
  });
};
