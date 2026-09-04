import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from './auth';
import type { GatewayConfig } from './config';
import type { TableHub } from '../live/table-hub';
import type { LobbyService } from '../lobby';
import { DEFAULT_ROOM } from '../live/poker-room';
import { variant } from '../games/texas/variants';
import { registerPublicTable } from '../live/runtime-tables';

/**
 * Player-created tables (owner-approved, not in the FairPlay doc).
 *
 * Any authenticated player can open a table and pick whether it's PUBLIC (also
 * listed in the lobby, anyone can join) or PRIVATE (reachable only by its link —
 * "play with friends"). Distinct from league tables (league-scoped, membership
 * checked) and from the fixed lobby tables in `defaultTables()`.
 *
 * v1 is Hold'em only, on the same config as the default cash table. The share
 * link the client builds is just `/table/<tableId>`, which `isOpenableTableId`
 * on the frontend now recognises via the `t-` shape minted here.
 */
export function buildPlayerTableRouter(
  config: GatewayConfig,
  deps: { hub: TableHub; lobby: LobbyService },
): Router {
  const r = Router();

  const createBody = z.object({
    // Poker only for now; the enum leaves room to widen without a breaking change.
    game: z.enum(['texas']).default('texas'),
    visibility: z.enum(['public', 'private']).default('private'),
    /**
     * How many chairs the table has — NOT how many players it needs. Two ready
     * players is enough to deal whatever this is set to; the rest of the chairs
     * simply sit empty until someone takes one.
     *
     * The ceiling comes from the VARIANT rather than being written here, so it
     * follows the felt automatically when the enum above widens past texas —
     * which is what the previous version of this comment promised and did not
     * do. See `PokerVariant.maxSeats`.
     */
    seats: z.number().int().min(2).max(variant('texas').maxSeats).default(6),
  });

  r.post('/', requireAuth(config), (req: Request, res: Response): void => {
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

    // `t-<12 hex>` — the shape the frontend's isOpenableTableId whitelists, kept
    // distinct from the league `lg-…` and the fixed game-slug ids.
    const tableId = `t-${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    // Same config as the default Hold'em cash table (rake → Treasury; PLATFORM).
    deps.hub.addTable({
      ...DEFAULT_ROOM,
      id: tableId,
      game: 'texas',
      name: "Hold'em · $0.10/0.20",
      maxSeats: input.seats,
    });

    // Public → list it now AND register it so the 5s lobby resync keeps it (the
    // resync removes any lobby row it can't find in its identity list). Private →
    // neither; it lives only in the hub, reached by the link.
    if (input.visibility === 'public') {
      registerPublicTable(tableId, 'texas');
      // DEFAULT_ROOM's exported type widens these to `unknown`; they are the
      // poker blinds/buy-in and always numbers at runtime.
      const bigBlind = DEFAULT_ROOM.bigBlind as number;
      const minBuyIn = DEFAULT_ROOM.minBuyIn as number;
      try {
        deps.lobby.addTable({
          id: tableId,
          gameId: 'texas',
          stakes: bigBlind,
          players: 0,
          jackpot: 0,
          buyInBB: Math.max(1, Math.floor(minBuyIn / bigBlind)),
        });
      } catch {
        // A listing failure isn't fatal — the room is open and the resync will
        // list it within 5s; the creator can still share the link immediately.
      }
    }

    res.status(201).json({ tableId, visibility: input.visibility });
  });

  return r;
}
