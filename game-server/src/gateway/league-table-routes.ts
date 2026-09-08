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
 * can change without a code change. Note the platform lobby's own 5% / $6-cap
 * rake is a DIFFERENT thing: league rake is a percentage inside a band, and the
 * doc gives league rake no cap at all.
 */

/**
 * Now wired: PokerRoom threads (tableType: 'LEAGUE', leagueId) from the table config into the
 * settlement request, so a league hand's rake routes to that league's Inventory and its insurance
 * draws that league's pool — never the platform's. The AUDIT STOP below is therefore lifted.
 */
const LEAGUE_SETTLEMENT_WIRED = true;

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
  const p = {
    minRakeBps: num('LEAGUE_MIN_RAKE_BPS', DEFAULT_POLICY.minRakeBps),
    maxRakeBps: num('LEAGUE_MAX_RAKE_BPS', DEFAULT_POLICY.maxRakeBps),
    maxTableHours: num('LEAGUE_MAX_TABLE_HOURS', DEFAULT_POLICY.maxTableHours),
    minBuyIn: num('LEAGUE_MIN_BUY_IN', DEFAULT_POLICY.minBuyIn),
    maxBuyIn: num('LEAGUE_MAX_BUY_IN', DEFAULT_POLICY.maxBuyIn),
  };
  // An inverted band (min > max) makes every rake invalid — every league table
  // un-openable with a message that blames the league. Loud fallback instead.
  if (p.minRakeBps > p.maxRakeBps || p.minBuyIn > p.maxBuyIn) {
    console.error('[league] platform policy band is inverted; using defaults', p);
    return { ...DEFAULT_POLICY };
  }
  return p;
}

const createBody = z.object({
  variantId: z.enum(['texas', 'short-deck', 'omaha']).default('texas'),
  smallBlind: z.number().int().positive(),
  bigBlind: z.number().int().positive(),
  maxSeats: z.number().int().min(2).max(9).default(6),
  name: z.string().trim().min(1).max(40).optional(),
});

/**
 * What financial-core reports, VALIDATED rather than cast. The audit showed a
 * 200 with an unexpected shape flowing through blind casts: a missing role
 * became a 403 instead of a 404, and a NaN rake would have sailed through
 * band checks (NaN compares false against both bounds).
 */
const membershipShape = z.object({ role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).nullable() });
const leagueFactsShape = z.object({
  leagueId: z.string().min(1),
  settings: z
    .object({
      rakeBps: z.number().int().min(0).max(10_000),
      tableHours: z.number().int().positive(),
      buyIn: z.number().int().nonnegative(),
      spectatorsAllowed: z.boolean(),
    })
    .nullable(),
  pendingRakeChange: z
    .object({ rakeBps: z.number().int().min(0).max(10_000), effectiveAt: z.string().min(1) })
    .nullable(),
});

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

  /** POST to financial-core, preserving its status and message on refusal —
   *  a grant refused for a real reason ("not a member", "insufficient") must
   *  reach the admin, not be flattened into a generic 502. */
  const internalPost = async (
    path: string,
    body: unknown,
  ): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> => {
    try {
      const res = await fetch(`${config.financialCoreUrl}/api/v1${path}`, {
        method: 'POST',
        headers: { 'x-internal-secret': config.internalApiSecret, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const parsed: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail =
          parsed && typeof parsed === 'object' && 'error' in parsed
            ? String((parsed as { error: unknown }).error)
            : 'league service unavailable';
        return { ok: false, status: res.status || 502, error: detail };
      }
      return { ok: true, body: parsed };
    } catch (err) {
      console.error('[league-tables] financial-core unreachable:', err);
      return { ok: false, status: 502, error: 'league service unavailable' };
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
      const membershipRaw = await internal<unknown>(
        `/internal/leagues/${encodeURIComponent(leagueId)}/members/${encodeURIComponent(playerId)}`,
      );
      if (!membershipRaw) {
        res.status(502).json({ error: 'league service unavailable' });
        return;
      }
      const membershipParsed = membershipShape.safeParse(membershipRaw);
      if (!membershipParsed.success) {
        console.error('[league-tables] membership response malformed:', membershipRaw);
        res.status(502).json({ error: 'league service unavailable' });
        return;
      }
      const membership = membershipParsed.data;

      const factsRaw = await internal<unknown>(`/leagues/${encodeURIComponent(leagueId)}`);
      if (!factsRaw) {
        res.status(502).json({ error: 'league service unavailable' });
        return;
      }
      const factsParsed = leagueFactsShape.safeParse(factsRaw);
      if (!factsParsed.success) {
        console.error('[league-tables] league facts malformed:', factsRaw);
        res.status(502).json({ error: 'league service unavailable' });
        return;
      }
      const facts = factsParsed.data;

      // A league that has never chosen settings cannot open a table on invented
      // numbers — it has to pick a rake first, deliberately.
      if (!facts.settings) {
        res.status(400).json({ error: 'set the league rake and buy-in before opening a table' });
        return;
      }

      // Date.parse of a malformed timestamp is NaN, and `now < NaN` is false —
      // which would count the pending change as DUE and open the table on a
      // not-yet-effective rate, the exact thing "cannot apply early" forbids.
      // A pending change whose date cannot be read is treated as never due.
      const pendingAt = facts.pendingRakeChange ? Date.parse(facts.pendingRakeChange.effectiveAt) : NaN;
      const state: LeagueSettingsState = {
        settings: facts.settings,
        pendingRakeChange:
          facts.pendingRakeChange && Number.isFinite(pendingAt)
            ? { rakeBps: facts.pendingRakeChange.rakeBps, effectiveAt: pendingAt }
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

      // Kill switch. League settlement is wired (PokerRoom now threads tableType/leagueId into the
      // settlement request, so rake routes to League Inventory), so this is normally open. It stays
      // here as a deliberate off-ramp: flip LEAGUE_SETTLEMENT_WIRED back to false and league tables
      // stop opening — better a refusal than a table whose rake could go to the wrong owner.
      if (!LEAGUE_SETTLEMENT_WIRED) {
        res.status(503).json({
          error: 'league tables are temporarily closed',
        });
        return;
      }

      // Open the room, then publish it to the lobby. This order matters: a table
      // listed but not running is a row players can tap into and find nothing,
      // whereas a room running but briefly unlisted is merely invisible. If the
      // lobby listing fails after the room opened, the room is running but
      // unlisted — withdraw it rather than leave a ghost.
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
        // NO CAP on league rake — the doc gives league rake a band, not a cap.
        // computeRake applies `cap` as an unconditional Math.min, so the audit
        // caught the previous `cap: 0` raking exactly ZERO on every hand: the
        // one number that means "cap at nothing" is the ceiling itself.
        rake: { bps: plan.rakeBps, cap: Number.MAX_SAFE_INTEGER, noFlopNoDrop: true },
        tableType: 'LEAGUE',
        leagueId: plan.leagueId,
      });

      try {
        deps.lobby.addTable({
          id: plan.tableId,
          gameId: plan.variantId,
          stakes: plan.bigBlind,
          // Sent, not derived. Both clients used to render `stakes / 2`, which
          // is right only while every table is half-and-half — and a league
          // admin chooses these two figures independently.
          smallBlind: plan.smallBlind,
          players: 0,
          jackpot: 0,
          buyInBB: Math.max(1, Math.floor(plan.minBuyIn / plan.bigBlind)),
          tableType: 'LEAGUE',
          leagueId: plan.leagueId,
        });
      } catch (err) {
        deps.lobby.removeTable(plan.tableId);
        console.error('[league-tables] lobby listing failed; table withdrawn:', err);
        res.status(500).json({ error: 'could not open the table' });
        return;
      }

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
    })().catch((err) => {
      // Nothing in here may become an unhandled rejection: that hangs the
      // request AND (Node default) kills the process — every live table on it.
      console.error('[league-tables] create failed:', err);
      if (!res.headersSent) res.status(500).json({ error: 'could not open the table' });
    });
  });

  /**
   * A league admin grants chips from the league's inventory to a member.
   *
   * The league economy's missing middle: the spec gives the league an on-ramp
   * (TREASURY → LEAGUE_INVENTORY) and an off-ramp, but nothing reached a
   * player, so a member's league wallet stayed empty and league tables could
   * never be sat at.
   *
   * Same authority as opening a room — OWNER or ADMIN of THIS league, taken
   * from the verified token. A plain member gets 403, a stranger 404 (whether a
   * league exists is not a stranger's to probe). financial-core independently
   * checks the RECIPIENT is a member, so neither service trusts the other's
   * word about who belongs where.
   */
  const grantBody = z.object({
    playerId: z.string().min(1),
    /** Decimal string; financial-core parses it as Money — never a float. */
    amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'amount must be a positive decimal'),
    /**
     * Idempotency key — REQUIRED, and the client's to generate.
     *
     * Not optional and not minted here: a reference invented per HTTP request
     * is no protection at all, since a double-submit is two requests. The
     * caller generates one when the admin commits to a grant and reuses it on
     * retry, so the second submit collapses onto the first transfer.
     */
    reference: z.string().min(1).max(100),
  });

  r.post('/:leagueId/grants', requireAuth(config), (req: Request, res: Response): void => {
    void (async (): Promise<void> => {
      const leagueId = String(req.params.leagueId ?? '');
      const playerId = req.player?.playerId;
      if (!playerId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      let input: z.infer<typeof grantBody>;
      try {
        input = grantBody.parse(req.body ?? {});
      } catch {
        res.status(400).json({
          error: 'invalid grant — playerId, amount and a unique reference are all required',
        });
        return;
      }

      const membershipRaw = await internal<unknown>(
        `/internal/leagues/${encodeURIComponent(leagueId)}/members/${encodeURIComponent(playerId)}`,
      );
      if (!membershipRaw) {
        res.status(502).json({ error: 'league service unavailable' });
        return;
      }
      const parsed = membershipShape.safeParse(membershipRaw);
      if (!parsed.success) {
        console.error('[league-tables] membership response malformed:', membershipRaw);
        res.status(502).json({ error: 'league service unavailable' });
        return;
      }

      const role = parsed.data.role;
      if (role === null) {
        res.status(404).json({ error: `no such league: ${leagueId}` });
        return;
      }
      if (role !== 'OWNER' && role !== 'ADMIN') {
        res.status(403).json({ error: 'only a league owner or admin can grant chips' });
        return;
      }

      const result = await internalPost(`/internal/leagues/${encodeURIComponent(leagueId)}/grants`, {
        playerId: input.playerId,
        amount: input.amount,
        // The granter is the authenticated caller, never anything in the body.
        grantedBy: playerId,
        reference: input.reference,
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json(result.body);
    })().catch((err) => {
      console.error('[league-tables] grant failed:', err);
      if (!res.headersSent) res.status(500).json({ error: 'could not complete the grant' });
    });
  });

  return r;
}
