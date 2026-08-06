import express, { type Express, type Request, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import { ChipBank } from './chip-bank';
import { DevPlayers } from './players';
import { DEFAULT_ROOM, type PokerRoomConfig } from './poker-room';
import { TableHub, type TokenVerifier } from './table-hub';
import { verifyToken } from '../gateway/tokens';

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
  /** Where table chips are persisted. Play money until the Financial Core is wired in. */
  chipsFile?: string;
  /** Origins allowed to call the HTTP API. Empty means "any" (fine for a token-guarded read). */
  corsOrigins: string[];
  tables: PokerRoomConfig[];
  /** Log every socket's fate. On by default: "it won't connect" is otherwise unanswerable. */
  logSockets?: boolean;
}

export interface TableServer {
  app: Express;
  server: Server;
  hub: TableHub;
  players: DevPlayers;
  /** Begin listening. Resolves with the port actually bound. */
  listen(): Promise<number>;
  close(): Promise<void>;
}

/** The tables a fresh deployment opens. Both seat six, matching the table artwork. */
export function defaultTables(): PokerRoomConfig[] {
  return [
    { ...DEFAULT_ROOM, id: 'texas', name: "Hold'em · ₮10/20" },
    {
      ...DEFAULT_ROOM,
      id: 'texas-high',
      name: "Hold'em · ₮50/100",
      smallBlind: 50,
      bigBlind: 100,
      minBuyIn: 2_000,
      maxBuyIn: 20_000,
      rake: { bps: 500, cap: 3_000, noFlopNoDrop: true },
    },
  ];
}

export function createTableServer(config: TableServerConfig): TableServer {
  const verifyPlayerToken: TokenVerifier = (token) => ({
    playerId: verifyToken(token, config.jwtSecret).playerId,
  });

  const players = new DevPlayers({
    ...(config.chipsFile ? { file: config.chipsFile } : {}),
    startingChips: 10_000,
  });
  const bank = new ChipBank(players);

  const hub = new TableHub(
    { directory: players, fc: bank },
    verifyPlayerToken,
    config.logSockets === false
      ? undefined
      : (event): void => {
          const who = event.playerId ? ` ${event.playerId}` : '';
          const why = event.reason ? ` (${event.reason})` : '';
          console.log(`  [socket] ${event.type}${who}${why}`);
        },
  );
  for (const table of config.tables) hub.addTable(table);

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

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'live-tables', tables: hub.tables().length });
  });

  app.get('/api/live/tables', (_req: Request, res: Response) => {
    res.json({ tables: hub.tables() });
  });

  /** Your buy-in budget. Identity comes from the token the Mini App already holds. */
  app.get('/api/live/chips', (req: Request, res: Response) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'missing bearer token' });
    try {
      const { playerId } = verifyPlayerToken(header.slice('Bearer '.length));
      return res.json({ playerId, available: players.ensure(playerId).available });
    } catch {
      return res.status(401).json({ error: 'invalid token' });
    }
  });

  const server = createServer(app);
  hub.attachTo(server, '/ws');

  return {
    app,
    server,
    hub,
    players,
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

  const server = createTableServer({
    port,
    jwtSecret,
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
    console.log(`  Player ids come from the session token (JWT_SECRET must match the issuer)\n`);
  });

  const shutdown = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
