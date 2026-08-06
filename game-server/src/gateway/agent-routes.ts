import { Router, type Request, type Response } from 'express';
import { requireAuth } from './auth';
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
  r.get('/eligibility', (req, res) => void forwardTo(config, req, res, '/me/agent/eligibility'));
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
