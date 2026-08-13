import type { Express, Request, Response } from 'express';
import { ChipBank } from './chip-bank';
import { DevPlayers, type PlayerDirectory } from './players';
import { TableHub, type TokenVerifier } from './table-hub';
import { ChipDenominatedFc } from './fc-chip-adapter';
import { FcPlayerDirectory } from './fc-directory';
import { HttpFinancialCoreClient, type FinancialCoreClient } from '../core/financial-core-client';
import { chainClientFromEnv } from '../fairness/chain-from-env';
import { verifyToken } from '../gateway/tokens';
import type { LiveTableConfig } from './live-room';

/**
 * Build the live-table hub, open its tables, and register its HTTP routes (`/api/live/*`) on `app`.
 *
 * The caller attaches the game socket to its own http server: `mounted.hub.attachTo(server, '/ws')`.
 * Splitting it this way lets the SAME live tables run two ways with identical behaviour:
 *   - the standalone table server (`createTableServer`), and
 *   - folded into the gateway, so one Heroku app serves the API and the game socket on one origin.
 *
 * The money backend is chosen by `financialCore`: set → the real ledger (chips→USDT via
 * `ChipDenominatedFc`, balances via `FcPlayerDirectory`); absent → the DevPlayers/ChipBank play-money
 * path. Not one line of room, game or settlement code differs between the two.
 */
export interface MountLiveOptions {
  jwtSecret: string;
  financialCore?: { baseUrl: string; internalSecret: string };
  chipsFile?: string;
  tables: LiveTableConfig[];
  logSockets?: boolean;
}

export interface MountedLive {
  hub: TableHub;
  /** Present only in dev (play-money) mode. */
  players?: DevPlayers;
}

export function mountLiveTables(app: Express, opts: MountLiveOptions): MountedLive {
  const verifyPlayerToken: TokenVerifier = (token) => ({
    playerId: verifyToken(token, opts.jwtSecret).playerId,
  });

  let directory: PlayerDirectory;
  let fc: FinancialCoreClient;
  let devPlayers: DevPlayers | undefined;
  let fcDirectory: FcPlayerDirectory | undefined;

  if (opts.financialCore) {
    const apiBase = `${opts.financialCore.baseUrl.replace(/\/$/, '')}/api/v1`;
    fc = new ChipDenominatedFc(
      new HttpFinancialCoreClient({ baseUrl: apiBase, internalSecret: opts.financialCore.internalSecret }),
    );
    fcDirectory = new FcPlayerDirectory({ baseUrl: apiBase, internalSecret: opts.financialCore.internalSecret });
    directory = fcDirectory;
  } else {
    devPlayers = new DevPlayers({
      ...(opts.chipsFile ? { file: opts.chipsFile } : {}),
      startingChips: 10_000,
    });
    directory = devPlayers;
    fc = new ChipBank(devPlayers);
  }

  const hub = new TableHub(
    // The chain notary is decided by env once, here: real Solana when configured, the deterministic
    // fake otherwise. See chain-from-env.ts.
    { directory, fc, chain: chainClientFromEnv() },
    verifyPlayerToken,
    opts.logSockets === false
      ? undefined
      : (event): void => {
          const who = event.playerId ? ` ${event.playerId}` : '';
          const why = event.reason ? ` (${event.reason})` : '';
          console.log(`  [socket] ${event.type}${who}${why}`);
        },
  );
  for (const table of opts.tables) hub.addTable(table);

  app.get('/api/live/tables', (_req: Request, res: Response) => {
    res.json({ tables: hub.tables() });
  });

  /** Your buy-in budget, in chips. Identity comes from the token the Mini App already holds; in
   *  real-money mode this is a fresh read of the Financial Core available balance. */
  app.get('/api/live/chips', (req: Request, res: Response): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing bearer token' });
      return;
    }
    let playerId: string;
    try {
      ({ playerId } = verifyPlayerToken(header.slice('Bearer '.length)));
    } catch {
      res.status(401).json({ error: 'invalid token' });
      return;
    }
    const available = fcDirectory
      ? fcDirectory.availableChips(playerId)
      : Promise.resolve(devPlayers!.ensure(playerId).available);
    available
      .then((chips) => res.json({ playerId, available: chips }))
      .catch(() => res.status(502).json({ error: 'balance unavailable' }));
  });

  return { hub, ...(devPlayers ? { players: devPlayers } : {}) };
}
