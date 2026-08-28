import express, { type Express, type Request, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import type { DevPlayers } from './players';
import { DEFAULT_ROOM } from './poker-room';
import type { LiveTableConfig } from './live-room';
import type { TableHub } from './table-hub';
import { mountLiveTables } from './mount';
import { bankerMinimumFor } from './niu-niu-room';

/**
 * The live table service — HTTP for the table list, WebSocket for the game.
 *
 * It authenticates nobody. It verifies the player token the Mini App already holds (signed by
 * `gateway/tokens`, whether that came from the Express gateway or the Netlify auth function) and
 * reads `playerId` out of it. Sign-in, Telegram and accounts belong upstream.
 *
 * This lives in `src/` rather than `scripts/` because it has to be *deployed*: `tsconfig.build.json`
 * compiles `src/**` only, so a server sitting in `scripts/` can be run with ts-node locally and
 * never shipped anywhere. A Telegram Mini App is served over HTTPS and can only open a `wss://`
 * socket, which means this process needs a real public host — Netlify Functions cannot hold a
 * socket open.
 */

export interface TableServerConfig {
  port: number;
  jwtSecret: string;
  /** Where table chips are persisted. Only used in dev (play-money) mode, i.e. when
   *  `financialCore` is absent. */
  chipsFile?: string;
  /**
   * When set, tables settle real money through the Financial Core ledger (1 chip = $0.01) instead
   * of the local play-chip bank. Absent → the DevPlayers/ChipBank play-money path, for local dev.
   */
  financialCore?: { baseUrl: string; internalSecret: string };
  /** Origins allowed to call the HTTP API. Empty means "any" (fine for a token-guarded read). */
  corsOrigins: string[];
  tables: LiveTableConfig[];
  /** Log every socket's fate. On by default: "it won't connect" is otherwise unanswerable. */
  logSockets?: boolean;
}

export interface TableServer {
  app: Express;
  server: Server;
  hub: TableHub;
  /** The play-money ledger — present only in dev mode (absent when settling through the FC). */
  players?: DevPlayers;
  /** Begin listening. Resolves with the port actually bound. */
  listen(): Promise<number>;
  close(): Promise<void>;
}

/**
 * The tables a fresh deployment opens — one per catalogued game.
 *
 * Stakes are in chips; 1 chip = $0.01 (v5.9 spec: amounts are integer cents). So the $0.10/0.20
 * table below has 10/20-chip blinds and a 2,000-chip ($20) buy-in.
 */
export function defaultTables(): LiveTableConfig[] {
  return [
    { ...DEFAULT_ROOM, id: 'texas', game: 'texas', name: "Hold'em · $0.10/0.20" },
    {
      ...DEFAULT_ROOM,
      id: 'texas-high',
      game: 'texas',
      name: "Hold'em · $0.50/1",
      smallBlind: 50,
      bigBlind: 100,
      minBuyIn: 2_000,
      maxBuyIn: 20_000,
      rake: { bps: 500, cap: 3_000, noFlopNoDrop: true },
    },

    // Poker variants — same PokerRoom, same real-money rail; a variant only changes the deck,
    // hole-card count and scoring (see games/texas/variants.ts).
    { ...DEFAULT_ROOM, id: 'short-deck', game: 'short-deck', variantId: 'short-deck', name: 'Short Deck · $0.10/0.20' },
    { ...DEFAULT_ROOM, id: 'omaha', game: 'omaha', variantId: 'omaha', name: 'Omaha · $0.10/0.20' },
    { id: 'baccarat', name: 'Baccarat · Player Banked', game: 'baccarat', minBuyIn: 1_000, maxBuyIn: 50_000, maxSeats: 8, rakeBps: 500, tiePayout: 8 },
    // The buy-in is DERIVED from the exposure rule, not picked: whoever holds the bank must be able
    // to cover every other seat staking the minimum and all of them turning over Five Small (6x).
    // At $1,000 the guard refused the second bettor and the table looked broken.
    { id: 'niu-niu', name: 'Niu Niu · Player Banked', game: 'niu-niu', minBuyIn: bankerMinimumFor(6, 100), maxBuyIn: 50_000, maxSeats: 6, rakeBps: 500 },
    { id: 'san-zhang', name: 'San Zhang · Player Banked', game: 'san-zhang', minBuyIn: 1_000, maxBuyIn: 50_000, maxSeats: 6, rakeBps: 500 },
    { id: 'red-packet', name: 'Red Packet Minesweeper', game: 'red-packet', size: 25, mineCount: 5, minBuyIn: 1_000, maxBuyIn: 50_000, maxSeats: 8, rakeBps: 500 },
    { id: 'cowboy-beauty', name: 'Cowboy & Beauty', game: 'cowboy-beauty', minBuyIn: 1_000, maxBuyIn: 50_000, maxSeats: 8, rakeBps: 500 },
    { id: 'dou-di-zhu', name: 'Dou Di Zhu · Fight the Landlord', game: 'dou-di-zhu', baseStake: 100, minBuyIn: 1_000, maxBuyIn: 50_000, maxSeats: 3, rakeBps: 500 },
    { id: 'lottery', name: 'Lottery Draw', game: 'lottery', range: 10, minBuyIn: 1_000, maxBuyIn: 50_000, maxSeats: 8, rakeBps: 500 },
    { id: 'slots', name: 'Classic Slots', game: 'slots', minBuyIn: 1_000, maxBuyIn: 50_000, maxSeats: 6, commissionBps: 500 },
    // The rake is required, not decorative: without it every settlement amount comes out NaN.
    { id: 'texas-cowboy', name: 'Texas Cowboy', game: 'texas-cowboy', minBuyIn: 1_000, maxBuyIn: 50_000, maxSeats: 100, rakeBps: 500 },
  ];
}

export function createTableServer(config: TableServerConfig): TableServer {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.use((req: Request, res: Response, next) => {
    const origin = req.headers.origin;
    const allowed = config.corsOrigins.length === 0 || (origin ? config.corsOrigins.includes(origin) : false);
    if (origin && allowed) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(allowed ? 204 : 403);
    return next();
  });

  // The hub + its /api/live/* routes + the money backend all come from mountLiveTables — the same
  // code the gateway uses when the two are folded into one process.
  const mounted = mountLiveTables(app, {
    jwtSecret: config.jwtSecret,
    ...(config.financialCore ? { financialCore: config.financialCore } : {}),
    ...(config.chipsFile ? { chipsFile: config.chipsFile } : {}),
    tables: config.tables,
    ...(config.logSockets !== undefined ? { logSockets: config.logSockets } : {}),
  });
  const { hub } = mounted;

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'live-tables', tables: hub.tables().length });
  });

  const server = createServer(app);
  hub.attachTo(server, '/ws');

  return {
    app,
    server,
    hub,
    ...(mounted.players ? { players: mounted.players } : {}),
    listen: (): Promise<number> =>
      new Promise((resolve) => {
        // 0.0.0.0, not localhost: every container platform routes to the former only.
        server.listen(config.port, '0.0.0.0', () => resolve(config.port));
      }),
    close: async (): Promise<void> => {
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Read the environment and start. This is the deployed entry point. */
export function startFromEnv(): TableServer {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required — it must match whatever issues player tokens');
  }

  // TABLES_PORT wins locally (the gateway already owns PORT in .env); on a hosting platform only
  // the injected PORT exists, and binding anything else means the health check never passes.
  const port = Number(process.env.TABLES_PORT ?? process.env.PORT ?? 4200);

  // Real money when both are present; play-money dev mode otherwise. Requiring the internal secret
  // as well as the URL means a half-configured deploy stays in dev mode rather than firing
  // unauthenticated calls at the ledger.
  const fcUrl = process.env.FINANCIAL_CORE_URL;
  const fcSecret = process.env.INTERNAL_API_SECRET;
  const financialCore = fcUrl && fcSecret ? { baseUrl: fcUrl, internalSecret: fcSecret } : undefined;

  const server = createTableServer({
    port,
    jwtSecret,
    ...(financialCore ? { financialCore } : {}),
    ...(process.env.TABLE_CHIPS_FILE ? { chipsFile: process.env.TABLE_CHIPS_FILE } : {}),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    tables: defaultTables(),
  });

  void server.listen().then((bound) => {
    console.log(`\n  Live tables   http://localhost:${bound}`);
    console.log(`  Game socket   ws://localhost:${bound}/ws`);
    console.log(`  Open tables   ${defaultTables().map((t) => t.id).join(', ')}`);
    console.log(
      financialCore
        ? `  Money         REAL — settling through the Financial Core at ${fcUrl} (1 chip = $0.01)`
        : `  Money         PLAY CHIPS — set FINANCIAL_CORE_URL + INTERNAL_API_SECRET for real money`,
    );
    console.log(`  Player ids come from the session token (JWT_SECRET must match the issuer)\n`);
  });

  const shutdown = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
