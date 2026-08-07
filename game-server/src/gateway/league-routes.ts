import { Router, type Request, type Response } from 'express';
import { leagueStore } from '../league/league-store';
import { requireAuth } from './auth';
import type { GatewayConfig } from './config';

export function buildLeagueRouter(config: GatewayConfig): Router {
  const r = Router();

  r.get('/mine', requireAuth(config), (_req: Request, res: Response) => {
    // For now, we will return the "Dragon Alliance" for all signed-in users,
    // to match the previous frontend mock behavior where everyone was in it.
    const myLeague = leagueStore.getProfile('123456');
    res.json({ league: myLeague || null });
  });

  r.get('/recommended', requireAuth(config), (_req: Request, res: Response) => {
    // Return all leagues except the one the user is in.
    const all = leagueStore.getAllProfiles();
    const recommended = all.filter(l => l.id !== '123456');
    res.json({ recommended });
  });

  return r;
}
