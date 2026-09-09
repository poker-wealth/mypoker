import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from './auth';
import type { GatewayConfig } from './config';
import type { TableHub } from '../live/table-hub';
import type { LobbyService } from '../lobby';
import { DEFAULT_ROOM } from '../live/poker-room';
import { defaultTables } from '../live/server';
import { variant, VARIANTS } from '../games/texas/variants';

/** The three games PokerRoom deals — the ones with a full options screen. */
const POKER_GAMES = ['texas', 'short-deck', 'omaha'] as const;
type PokerGame = (typeof POKER_GAMES)[number];

/**
 * Every other game a player may open a table for. The table is a fresh copy of
 * that game's house table (`defaultTables()` is the single source of those
 * configs) — the poker-specific fields on the request (blinds, straddle, …)
 * mean nothing to these rooms and are deliberately ignored rather than
 * refused, so one create screen can serve every game.
 */
const HOUSE_GAMES = [
  'baccarat',
  'niu-niu',
  'san-zhang',
  'red-packet',
  'cowboy-beauty',
  'dou-di-zhu',
  'lottery',
  'slots',
  'texas-cowboy',
] as const;

/**
 * The largest seat count ANY poker variant allows, as a first-pass bound so zod
 * can reject absurd input before the per-game check below sees it. The real
 * ceiling is `PokerVariant.maxSeats` for the game actually chosen.
 */
const MAX_ANY_SEATS = Math.max(...Object.values(VARIANTS).map((v) => v.maxSeats));

/**
 * Blinds are chips; 1 chip = $0.01. A table named for its stakes has to show
 * what a player will actually post, so "10/20" reads as "$0.10/0.20".
 */
function stakeLabel(smallBlind: number, bigBlind: number): string {
  const money = (chips: number): string =>
    (chips / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${money(smallBlind)}/${money(bigBlind)}`;
}
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
    game: z.enum([...POKER_GAMES, ...HOUSE_GAMES]).default('texas'),
    visibility: z.enum(['public', 'private']).default('private'),
    /**
     * How many chairs the table has — NOT how many players it needs. Two ready
     * players is enough to deal whatever this is set to; the rest of the chairs
     * simply sit empty until someone takes one.
     *
     * Bounded loosely here and exactly below, because the real ceiling depends
     * on which game was picked (`PokerVariant.maxSeats`) and zod cannot see a
     * sibling field from inside a per-field rule.
     */
    seats: z.number().int().min(2).max(MAX_ANY_SEATS).default(6),
    /** Chips, not currency. 1 chip = $0.01, as everywhere else in the rail. */
    smallBlind: z.number().int().min(1).max(1_000_000).default(DEFAULT_ROOM.smallBlind as number),
    bigBlind: z.number().int().min(2).max(2_000_000).default(DEFAULT_ROOM.bigBlind as number),
    /**
     * The minimum buy-in, expressed in BIG BLINDS rather than chips.
     *
     * Blinds and buy-in move together — a 20bb minimum means something at every
     * stake, where a flat chip figure is deep at one table and unplayable at the
     * next. It is also how the reference asks the question.
     */
    buyInBB: z.number().int().min(10).max(500).default(20),
    /**
     * The maximum buy-in, in big blinds. Absent keeps the 10x spread the house
     * table uses; present, it must sit at or above the minimum (checked below,
     * where both fields are in hand).
     */
    buyInMaxBB: z.number().int().min(10).max(2000).optional(),

    // ── Game options (the reference app's "create a game" screen) ──────────
    // Everything defaults to how tables always behaved: off.

    /** Forced ante, chips, dead into the pot. Bounded per-BB below. */
    ante: z.number().int().min(0).max(4_000_000).default(0),
    straddle: z.boolean().default(false),
    allInOrFold: z.boolean().default(false),
    hideHoleCards: z.boolean().default(false),
    /** UI shows "restricting onlookers"; the wire carries the positive fact. */
    spectatorsAllowed: z.boolean().default(true),
    insuranceEnabled: z.boolean().default(true),
    banSameIp: z.boolean().default(false),
    banSameGps: z.boolean().default(false),
    /**
     * Seated players required before the FIRST hand deals. 0 is "None": the
     * table waits for the creator's start_game command. 1 is meaningless (one
     * player is not a game) and refused.
     */
    autoStartPlayers: z
      .number()
      .int()
      .min(0)
      .max(9)
      .refine((n) => n !== 1, 'one player is not a game')
      .default(2),
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

    // A house game: the table is a fresh copy of that game's standing table.
    // No creator options apply — those rooms read their own config shape, and
    // `defaultTables()` is the one source of it.
    if (!(POKER_GAMES as readonly string[]).includes(input.game)) {
      const template = defaultTables().find((t) => t.game === input.game);
      if (!template) {
        res.status(400).json({ error: `no house table for ${input.game}`, code: 'unknown_game' });
        return;
      }
      const room = deps.hub.addTable({ ...template, id: tableId });
      if (input.visibility === 'public') {
        registerPublicTable(tableId, input.game);
        // The lobby row exactly as the 5s resync would rebuild it (live-sync
        // reads these off the summary), so the row does not change shape five
        // seconds after it appears.
        const s = room.summary();
        try {
          deps.lobby.addTable({
            id: tableId,
            gameId: input.game,
            stakes: s.bigBlind,
            players: 0,
            jackpot: 0,
            // `bigBlind` went nullable when the lobby row did (#61) — a stakeless
            // house game (slots, lottery) reports null. No blind → no BB depth.
            buyInBB: s.bigBlind ? Math.round(s.minBuyIn / s.bigBlind) : 0,
          });
        } catch {
          // A listing failure isn't fatal — the room is open and the resync will
          // pick it up.
        }
      }
      res.status(201).json({ tableId, game: input.game, visibility: input.visibility });
      return;
    }

    // Poker from here down. The rules zod could not express, because each
    // needs a second field.
    const chosen = variant(input.game as PokerGame);
    if (input.seats > chosen.maxSeats) {
      res.status(400).json({
        error: `a ${chosen.name} table seats between 2 and ${chosen.maxSeats}`,
        code: 'seats_out_of_range',
      });
      return;
    }
    if (input.smallBlind >= input.bigBlind) {
      res.status(400).json({
        error: 'the small blind must be smaller than the big blind',
        code: 'blind_order',
      });
      return;
    }
    // The remaining cross-field rules, same shape as the two above.
    if (input.buyInMaxBB !== undefined && input.buyInMaxBB < input.buyInBB) {
      res.status(400).json({
        error: 'the maximum buy-in cannot sit below the minimum',
        code: 'buy_in_order',
      });
      return;
    }
    // 2×BB is a big-blind-ante-sized ceiling — the spec is silent on antes, so
    // the bound is labelled the assumption it is rather than presented as spec.
    if (input.ante > input.bigBlind * 2) {
      res.status(400).json({
        error: 'the ante may not exceed twice the big blind',
        code: 'ante_too_large',
      });
      return;
    }
    if (input.allInOrFold && chosen.limit === 'POT_LIMIT') {
      // AoF means shoving; a pot-limit game exists to forbid exactly that.
      res.status(400).json({
        error: `${chosen.name} is pot-limit — all-in or fold does not apply`,
        code: 'aof_pot_limit',
      });
      return;
    }
    if (input.autoStartPlayers > input.seats) {
      res.status(400).json({
        error: 'auto-start cannot wait for more players than the table seats',
        code: 'auto_start_too_high',
      });
      return;
    }

    // Buy-in follows the blinds. An explicit maximum wins; absent one, the 10x
    // spread between min and max is the same shape DEFAULT_ROOM uses
    // (20bb / 200bb) rather than a new invention.
    const minBuyIn = input.bigBlind * input.buyInBB;
    const maxBuyIn = input.buyInMaxBB ? input.bigBlind * input.buyInMaxBB : minBuyIn * 10;

    // Rake → Treasury, PLATFORM, as with every open cash table. Everything else
    // is the creator's, so it is built from `input` rather than inherited from
    // the house table — a table called "Hold'em · $0.10/0.20" that deals Omaha
    // at 1/2 is worse than no name at all.
    deps.hub.addTable({
      ...DEFAULT_ROOM,
      id: tableId,
      game: input.game,
      variantId: input.game as PokerGame,
      name: `${chosen.name} · ${stakeLabel(input.smallBlind, input.bigBlind)}`,
      maxSeats: input.seats,
      smallBlind: input.smallBlind,
      bigBlind: input.bigBlind,
      minBuyIn,
      maxBuyIn,
      // The creator's game options. Only the non-defaults are written, so a
      // config file read in a debugger says what is special about this table
      // rather than restating every default.
      ...(input.ante > 0 ? { ante: input.ante } : {}),
      ...(input.straddle ? { straddle: true } : {}),
      ...(input.allInOrFold ? { allInOrFold: true } : {}),
      ...(input.hideHoleCards ? { hideHoleCards: true } : {}),
      ...(input.spectatorsAllowed ? {} : { spectatorsAllowed: false }),
      ...(input.insuranceEnabled ? {} : { insuranceEnabled: false }),
      ...(input.banSameIp ? { banSameIp: true } : {}),
      ...(input.banSameGps ? { banSameGps: true } : {}),
      ...(input.autoStartPlayers !== 2 ? { autoStartPlayers: input.autoStartPlayers } : {}),
      // The verified token, never the body — the owner is whoever CALLED this,
      // and a manual-start table obeys only them.
      ...(req.player ? { ownerId: req.player.playerId } : {}),
    });

    // Public → list it now AND register it so the 5s lobby resync keeps it (the
    // resync removes any lobby row it can't find in its identity list). Private →
    // neither; it lives only in the hub, reached by the link.
    if (input.visibility === 'public') {
      registerPublicTable(tableId, input.game);
      try {
        deps.lobby.addTable({
          id: tableId,
          gameId: input.game,
          // The creator's stakes, not the house table's. Listing an Omaha table
          // at Hold'em's blinds sends players to a table they did not choose.
          stakes: input.bigBlind,
          players: 0,
          jackpot: 0,
          buyInBB: input.buyInBB,
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
