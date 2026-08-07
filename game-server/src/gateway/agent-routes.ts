import { Router, type Request, type Response } from 'express';
import { requireAuth } from './auth';
import { scoreFor, GOOD_STANDING_SCORE, type FindingReason } from '../players/index';
import { forwardTo } from './me-routes';
import { assertValidSubAgentRate } from '../agents/commission';
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
  r.get('/players', (req, res) => void forwardTo(config, req, res, '/me/agent/players'));
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

  return r;
}


interface EligibilityFacts {
  roundsPlayed: number;
  findings: FindingReason[];
  alreadyAgent: boolean;
}

type Upstream = { ok: true; body: EligibilityFacts } | { ok: false; status: number; error: string };

async function upstreamEligibility(config: GatewayConfig, req: Request): Promise<Upstream> {
  try {
    const upstream = await fetch(`${config.financialCoreUrl}/api/v1/me/agent/eligibility`, {
      headers: { authorization: req.headers.authorization ?? '' },
    });
    const body: unknown = await upstream.json().catch(() => null);
    if (!upstream.ok || body === null) {
      return { ok: false, status: upstream.status, error: 'financial service unavailable' };
    }
    return { ok: true, body: body as EligibilityFacts };
  } catch (err) {
    console.error('[gateway] financial-core unreachable:', err);
    return { ok: false, status: 502, error: 'financial service unavailable' };
  }
}
