import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from './auth';
import type { GatewayConfig } from './config';
import type { TableHub } from '../live/table-hub';
import type { LobbyService } from '../lobby';
import { DEFAULT_ROOM } from '../live/poker-room';
import { registerPublicTable } from '../live/runtime-tables';
import { tableAccess } from './table-access';

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
 *
 * PRIVATE MEANS PRIVATE NOW. It used to mean "unlisted": `visibility` was
 * written here and read nowhere, so the table id was the only thing standing
 * between a stranger and a seat. A private table now mints a join code, and
 * `table-access.ts` is consulted on every inbound socket message before the
 * hub will act on it. Both references work this way — see
 * docs/REFERENCE-STUDY-HH.md §3.
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
     * Capped at 6 because that is what the portrait felt draws, and a chair the
     * artwork has no seat for is a chair nobody can reach. The wide Short Deck
     * felt draws 8, so this ceiling rises with the game once the enum above
     * widens past texas.
     */
    seats: z.number().int().min(2).max(6).default(6),
  });

  /** Digits only, and exactly as long as `table-access.ts` mints. */
  const unlockBody = z.object({ code: z.string().regex(/^\d{6}$/) });

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

    // Mint the code (private) or record the table as public. Done AFTER the room
    // exists so a failure to open leaves nothing registered behind it.
    const joinCode = tableAccess.register(tableId, input.visibility, playerId);

    res.status(201).json({ tableId, visibility: input.visibility, joinCode });
  });

  /**
   * Prove you hold a private table's code.
   *
   * Success is remembered for this player, so the code is typed once rather than
   * on every reconnect. The refusals are deliberately not distinguished for the
   * caller beyond what they need: a wrong code and a code for a table that does
   * not exist both read as a failure to get in, because telling them apart
   * would turn this into an oracle for which table ids are real.
   */
  r.post('/:tableId/unlock', requireAuth(config), (req: Request, res: Response): void => {
    const playerId = req.player?.playerId;
    if (!playerId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // Express types this as string | string[]. An array is not a table id, and
    // String()-ing one would join it to "a,b" and quietly become a lookup key,
    // so it is rejected rather than coerced.
    const raw = req.params.tableId;
    const tableId = typeof raw === 'string' ? raw : '';
    const parsed = unlockBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid code' });
      return;
    }

    const result = tableAccess.unlock(tableId, playerId, parsed.data.code);
    if (result === 'too-many-attempts') {
      res.status(429).json({ error: 'too many attempts — ask for the code again' });
      return;
    }
    if (result !== 'ok') {
      res.status(403).json({ error: 'wrong code' });
      return;
    }
    res.status(200).json({ tableId, unlocked: true });
  });

  return r;
}
