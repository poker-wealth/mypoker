import { Router, type Request, type Response } from 'express';
import { requireAuth } from './auth';
import { scoreFor, GOOD_STANDING_SCORE, tierForVolume, type FindingReason } from '../players/index';
import { forwardTo } from './me-routes';
import { assertValidSubAgentRate } from '../agents/commission';
import { AGENT_RANGES, isAgentRange, windowFor, activityFor } from '../agents/dashboard';
import type { GatewayConfig } from './config';

/**
 * Agent Center.
 *
 * The gateway owns the agent DOMAIN — rate bounds, the two-level limit, how a
 * hand's rake splits — so rules are enforced here and financial-core stores what
 * it is told. Restating '5% to parent minus 5%' on both sides would give two
 * answers to who keeps what, and they would drift.
 *
 * Every route is player-scoped and forwards the caller's own token, so an agent
 * can only ever read their own agency. Nothing below returns a balance; see
 * financial-core/src/agent/agent-store.ts for why that is structural.
 */
export function buildAgentRouter(config: GatewayConfig): Router {
  const r = Router();
  r.use(requireAuth(config));

  r.get('/', (req, res) => void forwardTo(config, req, res, '/me/agent'));
  // Eligibility is derived HERE from financial-core's facts, with the same
  // canonical scoring the reputation route uses — the 700 bar is
  // GOOD_STANDING_SCORE, not a second constant that could drift from it.
  r.get('/eligibility', (req: Request, res: Response) => {
    void (async () => {
      const facts = await upstreamEligibility(config, req);
      if (!facts.ok) {
        res.status(facts.status).json({ error: facts.error });
        return;
      }
      const { roundsPlayed, findings, alreadyAgent } = facts.body;
      const score = scoreFor(roundsPlayed, findings);

      const reasons: string[] = [];
      if (score < GOOD_STANDING_SCORE) reasons.push('reputation_below_700');
      // A colluder who ground back above 700 still does not become an agent.
      if (findings.includes('COLLUSION_CONFIRMED')) reasons.push('confirmed_collusion');
      if (findings.includes('BOT_CONFIRMED')) reasons.push('anti_bot_high_risk');

      res.json({
        eligible: reasons.length === 0 && !alreadyAgent,
        reasons,
        reputation: score,
        required: GOOD_STANDING_SCORE,
        alreadyAgent,
      });
    })();
  });
  // Tab 2. financial-core returns facts per player — volumes, commissions, when
  // they last played. The VIP tier and the activity colour are DERIVED here,
  // from the same ladder the VIP page uses and the same 7/30-day boundaries
  // §13.4 fixes, so an agent and the player never see different tiers.
  r.get('/players', (req: Request, res: Response) => {
    void (async () => {
      const upstream = await forwardJson<{ players: ReferredPlayerFacts[] }>(
        config,
        req,
        '/me/agent/players',
      );
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: upstream.error });
        return;
      }

      const now = new Date();
      res.json({
        players: upstream.body.players.map((p) => {
          const tier = tierForVolume(p.lifetimeEffective);
          return {
            ...p,
            vipTier: tier.tier,
            vipTitle: tier.title,
            activity: activityFor(p.lastActiveAt, now),
          };
        }),
      });
    })();
  });

  // Tab 1 and Tab 4 take a named range; the gateway resolves what it means.
  const withWindow = (path: string) => (req: Request, res: Response) => {
    const range = req.query.range ?? 'today';
    if (!isAgentRange(range)) {
      res.status(400).json({ error: `range must be one of ${AGENT_RANGES.join(', ')}` });
      return;
    }
    const { from, to } = windowFor(range);
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const source = req.query.source;
    if (source === 'DIRECT' || source === 'OVERRIDE') query.set('source', source);
    void forwardTo(config, req, res, `${path}?${query.toString()}`);
  };

  r.get('/breakdown', withWindow('/me/agent/breakdown'));
  r.get('/series', withWindow('/me/agent/series'));
  r.get('/settlements', withWindow('/me/agent/settlements'));

  r.get('/links', (req, res) => void forwardTo(config, req, res, '/me/agent/links'));
  r.post('/links', (req, res) => void forwardTo(config, req, res, '/me/agent/links'));
  r.get('/sub-agents', (req, res) => void forwardTo(config, req, res, '/me/agent/sub-agents'));

  r.post('/sub-agents', (req: Request, res: Response) => {
    const rateBps = (req.body as { rateBps?: unknown } | undefined)?.rateBps;
    if (typeof rateBps !== 'number' || !Number.isInteger(rateBps)) {
      res.status(400).json({ error: 'rateBps must be an integer number of basis points' });
      return;
    }
    try {
      // Rejected before it reaches storage: an out-of-bounds rate that got
      // written would quietly pay the wrong split on every subsequent hand.
      assertValidSubAgentRate(rateBps);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'invalid rate' });
      return;
    }
    void forwardTo(config, req, res, '/me/agent/sub-agents');
  });

  // Tab 3's [Edit Rate]. Same bounds as creation — a rate that is illegal to
  // set at creation must not become legal by editing afterwards.
  r.patch('/sub-agents/:subAgentId', (req: Request, res: Response) => {
    const rateBps = (req.body as { rateBps?: unknown } | undefined)?.rateBps;
    if (typeof rateBps !== 'number' || !Number.isInteger(rateBps)) {
      res.status(400).json({ error: 'rateBps must be an integer number of basis points' });
      return;
    }
    try {
      assertValidSubAgentRate(rateBps);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'invalid rate' });
      return;
    }
    void forwardTo(
      config,
      req,
      res,
      `/me/agent/sub-agents/${encodeURIComponent(String(req.params.subAgentId))}`,
    );
  });

  return r;
}

/** The per-player facts financial-core returns, before this layer derives from them. */
interface ReferredPlayerFacts {
  playerId: string;
  lastActiveAt: string | null;
  lifetimeEffective: number;
}


interface EligibilityFacts {
  roundsPlayed: number;
  findings: FindingReason[];
  alreadyAgent: boolean;
}

type Upstream<T> = { ok: true; body: T } | { ok: false; status: number; error: string };

/**
 * Read facts from financial-core, for routes that DERIVE rather than proxy.
 *
 * `forwardTo` streams a response straight through and is right for everything
 * this gateway does not reason about. These routes have to open the body — to
 * apply the VIP ladder, the activity boundaries — so they need it parsed.
 */
async function forwardJson<T>(
  config: GatewayConfig,
  req: Request,
  path: string,
): Promise<Upstream<T>> {
  try {
    const upstream = await fetch(`${config.financialCoreUrl}/api/v1${path}`, {
      headers: { authorization: req.headers.authorization ?? '' },
    });
    const body: unknown = await upstream.json().catch(() => null);
    if (!upstream.ok || body === null) {
      return { ok: false, status: upstream.status, error: 'financial service unavailable' };
    }
    return { ok: true, body: body as T };
  } catch (err) {
    console.error('[gateway] financial-core unreachable:', err);
    return { ok: false, status: 502, error: 'financial service unavailable' };
  }
}

const upstreamEligibility = (
  config: GatewayConfig,
  req: Request,
): Promise<Upstream<EligibilityFacts>> => forwardJson(config, req, '/me/agent/eligibility');
