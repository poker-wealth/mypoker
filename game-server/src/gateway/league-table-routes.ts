import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from './auth';
import type { GatewayConfig } from './config';
import type { LobbyService } from '../lobby/lobby-service';
import type { TableHub } from '../live/table-hub';
import { DEFAULT_ROOM } from '../live/poker-room';
import {
  planLeagueRoom,
  LeagueRoomError,
  type LeagueRoomActor,
} from '../league/league-rooms';
import { LeagueRuleError, type LeagueSettingsState, type PlatformLeaguePolicy } from '../league/league';

/**
 * Create a league private room (v5.9 §2, 12-week plan W8) — SAMUEL_V2 task 3.
 *
 * The lobby's "Create Private Table" button was disabled because no endpoint
 * existed. This is that endpoint, and it is deliberately mounted under
 * `/leagues/:leagueId/tables` rather than somewhere in the lobby, because the
 * doc is specific about who owns a private room:
 *
 *   "Platform Lobby (direct clients) + League Private Rooms (fully isolated)."
 *   "league tables visible only to league members, completely invisible to
 *    lobby players."
 *
 * A lobby player cannot open one. A league's owner or admin can, for their own
 * league, and the resulting table is invisible outside it — the lobby service
 * already enforces that read side in both directions.
 *
 * THE PLATFORM POLICY BAND IS CONFIGURATION, NOT A CONSTANT.
 *
 * `PlatformLeaguePolicy` comes from env, with the defaults below. The doc says a
 * league sets its rake "within platform min~max" and deliberately does not name
 * the numbers — they are platform policy, so they belong in config where policy
 * can change without a code change. Note the platform lobby's own 5% / ₮6-cap
 * rake is a DIFFERENT thing: league rake is a percentage inside a band, and the
 * doc gives league rake no cap at all.
 */

/** Defaults if unset. Wide enough to be permissive; the point is that they are configurable. */
const DEFAULT_POLICY: PlatformLeaguePolicy = {
  minRakeBps: 0,
  maxRakeBps: 700,
  maxTableHours: 24,
  minBuyIn: 1,
  maxBuyIn: 1_000_000,
};

export function platformLeaguePolicyFromEnv(env = process.env): PlatformLeaguePolicy {
  const num = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = Number(raw);
    // A malformed band would silently become NaN and let every comparison pass,
    // which is the opposite of a bound. Fall back loudly instead.
    if (!Number.isFinite(n)) {
      console.error(`[league] ${name}=${raw} is not a number; using ${fallback}`);
      return fallback;
    }
    return n;
  };
  return {
    minRakeBps: num('LEAGUE_MIN_RAKE_BPS', DEFAULT_POLICY.minRakeBps),
    maxRakeBps: num('LEAGUE_MAX_RAKE_BPS', DEFAULT_POLICY.maxRakeBps),
    maxTableHours: num('LEAGUE_MAX_TABLE_HOURS', DEFAULT_POLICY.maxTableHours),
    minBuyIn: num('LEAGUE_MIN_BUY_IN', DEFAULT_POLICY.minBuyIn),
    maxBuyIn: num('LEAGUE_MAX_BUY_IN', DEFAULT_POLICY.maxBuyIn),
  };
}

const createBody = z.object({
  variantId: z.enum(['texas', 'short-deck', 'omaha']).default('texas'),
  smallBlind: z.number().int().positive(),
  bigBlind: z.number().int().positive(),
  maxSeats: z.number().int().min(2).max(9).default(6),
  name: z.string().trim().min(1).max(40).optional(),
});

/** What financial-core reports about a league, as far as this route needs. */
interface LeagueFacts {
  leagueId: string;
  settings: { rakeBps: number; tableHours: number; buyIn: number; spectatorsAllowed: boolean } | null;
  pendingRakeChange: { rakeBps: number; effectiveAt: string } | null;
}

export function buildLeagueTableRouter(
  config: GatewayConfig,
  deps: { hub: TableHub; lobby: LobbyService; policy?: PlatformLeaguePolicy },
): Router {
  const r = Router();
  const policy = deps.policy ?? platformLeaguePolicyFromEnv();

  const internal = async <T>(path: string): Promise<T | null> => {
    try {
      const res = await fetch(`${config.financialCoreUrl}/api/v1${path}`, {
        headers: { 'x-internal-secret': config.internalApiSecret },
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (err) {
      console.error('[league-tables] financial-core unreachable:', err);
      return null;
    }
  };

  r.post('/:leagueId/tables', requireAuth(config), (req: Request, res: Response): void => {
    void (async (): Promise<void> => {
      const leagueId = String(req.params.leagueId ?? '');
      const playerId = req.player?.playerId;
      if (!playerId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      let input: z.infer<typeof createBody>;
      try {
        input = createBody.parse(req.body ?? {});
      } catch {
        res.status(400).json({ error: 'invalid table settings' });
        return;
      }

      // Membership comes from financial-core, which owns leagues — never from the
      // request. A caller claiming to be an admin of someone else's league is the
      // whole attack this endpoint has to refuse.
      const membership = await internal<{ role: 'OWNER' | 'ADMIN' | 'MEMBER' | null }>(
        `/internal/leagues/${encodeURIComponent(leagueId)}/members/${encodeURIComponent(playerId)}`,
      );
      if (!membership) {
        res.status(502).json({ error: 'league service unavailable' });
        return;
      }

      const facts = await internal<LeagueFacts>(`/leagues/${encodeURIComponent(leagueId)}`);
      if (!facts) {
        res.status(502).json({ error: 'league service unavailable' });
        return;
      }

      // A league that has never chosen settings cannot open a table on invented
      // numbers — it has to pick a rake first, deliberately.
      if (!facts.settings) {
        res.status(400).json({ error: 'set the league rake and buy-in before opening a table' });
        return;
      }

      const state: LeagueSettingsState = {
        settings: facts.settings,
        pendingRakeChange: facts.pendingRakeChange
          ? {
              rakeBps: facts.pendingRakeChange.rakeBps,
              effectiveAt: Date.parse(facts.pendingRakeChange.effectiveAt),
            }
          : null,
      };

      const actor: LeagueRoomActor = { playerId, leagueId, role: membership.role };

      let plan;
      try {
        plan = planLeagueRoom(actor, state, policy, input, Date.now());
      } catch (err) {
        if (err instanceof LeagueRoomError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        if (err instanceof LeagueRuleError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }

      // Open the room, then publish it to the lobby. This order matters: a table
      // listed but not running is a row players can tap into and find nothing,
      // whereas a room running but briefly unlisted is merely invisible.
      deps.hub.addTable({
        ...DEFAULT_ROOM,
        id: plan.tableId,
        name: plan.name,
        game: plan.variantId,
        variantId: plan.variantId,
        smallBlind: plan.smallBlind,
        bigBlind: plan.bigBlind,
        minBuyIn: plan.minBuyIn,
        maxBuyIn: plan.maxBuyIn,
        maxSeats: plan.maxSeats,
        rake: { bps: plan.rakeBps, cap: 0, noFlopNoDrop: true },
        tableType: 'LEAGUE',
        leagueId: plan.leagueId,
      });

      deps.lobby.addTable({
        id: plan.tableId,
        gameId: plan.variantId,
        stakes: plan.bigBlind,
        players: 0,
        jackpot: 0,
        buyInBB: Math.max(1, Math.floor(plan.minBuyIn / plan.bigBlind)),
        tableType: 'LEAGUE',
        leagueId: plan.leagueId,
      });

      res.status(201).json({
        tableId: plan.tableId,
        name: plan.name,
        leagueId: plan.leagueId,
        variantId: plan.variantId,
        smallBlind: plan.smallBlind,
        bigBlind: plan.bigBlind,
        maxSeats: plan.maxSeats,
        // Named so a league admin can see the rate the table actually opened on,
        // which during a 7-day transition is NOT the rate they last requested.
        rakeBps: plan.rakeBps,
        rakeDestination: plan.rakeDestination,
        spectatorsAllowed: plan.spectatorsAllowed,
      });
    })();
  });

  return r;
}
