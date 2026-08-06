import { Router, type Request, type Response } from 'express';
import { TIERS, TIER_CONFIG, GRAND_WINDOW, type JackpotTier } from '../jackpot/index';
import { grandWindow, isInGrandWindow } from '../jackpot/schedule';
import type { LobbyService } from '../lobby/lobby-service';

/**
 * Public jackpot state.
 *
 * Open, like the lobby: the pools are the shop window, and a player deciding
 * whether to sit down should not have to sign in to see what is on the table.
 *
 * Amounts are aggregated across tables. Each table owns four independent pools
 * per the spec, but a player looking at the lobby is asking "how much is out
 * there", not "how much is on table tx-3" — the per-table figure already appears
 * on its own row.
 */

export interface TierState {
  tier: JackpotTier;
  /** Current pool, micro-USD, summed across tables. */
  amount: number;
  /** Pool must reach this before the tier can pay at all. */
  minThreshold: number;
  /** True once the pool is over its threshold — i.e. it can actually drop. */
  armed: boolean;
  /** Share of the pool paid out on a hit, in basis points. */
  payoutBps: number;
  /** Share of each injection that lands here, in basis points. */
  injectionBps: number;
  cadence: string;
}

export function buildJackpotRouter(lobby: LobbyService): Router {
  const r = Router();

  r.get('/', (_req: Request, res: Response) => {
    const now = Date.now();
    const window = grandWindow(now);

    // The pools live per table; the lobby is the only place that knows the whole
    // set. Split each table's pool by the same 20/30/25/25 the injection uses, so
    // the tiers shown always sum to the total the lobby reports.
    const totals: Record<JackpotTier, number> = { MINI: 0, MINOR: 0, MAJOR: 0, GRAND: 0 };
    for (const table of lobby.listTables()) {
      for (const tier of TIERS) {
        totals[tier] += Math.floor((table.jackpot * TIER_CONFIG[tier].injectionBps) / 10000);
      }
    }

    const tiers: TierState[] = TIERS.map((tier) => {
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

    res.json({
      tiers,
      total: tiers.reduce((sum, t) => sum + t.amount, 0),
      grand: {
        // The window is the interesting part of Grand — it can only ever drop
        // inside it, so a countdown is the honest way to present the tier.
        open: isInGrandWindow(now),
        opensAt: new Date(window.start).toISOString(),
        closesAt: new Date(window.end).toISOString(),
        timezoneOffsetHours: GRAND_WINDOW.timezoneOffsetHours,
        weekday: GRAND_WINDOW.weekday,
        startHour: GRAND_WINDOW.startHour,
        endHour: GRAND_WINDOW.endHour,
      },
    });
  });

  return r;
}
