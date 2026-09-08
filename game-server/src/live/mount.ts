import type { Express, Request, Response } from 'express';
import { ChipBank } from './chip-bank';
import { DevPlayers, type PlayerDirectory } from './players';
import { TableHub, type TokenVerifier } from './table-hub';
import type { GameSocketServerConfig } from '../transport/ws-server';
import { ChipDenominatedFc } from './fc-chip-adapter';
import { FcPlayerDirectory } from './fc-directory';
import { HttpFinancialCoreClient, type FinancialCoreClient } from '../core/financial-core-client';
import { chainClientFromEnv } from '../fairness/chain-from-env';
import { MerkleRoundNotary, type RoundNotary } from '../fairness/round-notary';
import type { LiveRoom } from './live-room';
import { ensureRuleCommitment, ensureGameRuleCommitment } from '../fairness/rule-commitment';
import { MongoMerkleStore, getRoundFairness } from '../fairness/round-store';
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
  /** Notarize settled rounds on-chain. Requires a connected DB to persist proofs — enable only where
   *  the process has one (the folded gateway), not the standalone table server. */
  notarize?: boolean;
  /**
   * Whether a player may open a socket at all — see
   * `GameSocketServerConfig.authorizeSession`.
   *
   * Passed IN rather than built here for the same reason `notarize` is opt-in:
   * this module is shared with the standalone table server, which has no user
   * database to ask. The folded gateway supplies one; a DB-less deployment
   * leaves it out and keeps today's behaviour.
   */
  authorizeSession?: GameSocketServerConfig['authorizeSession'];
}

export interface MountedLive {
  hub: TableHub;
  /** Present only in dev (play-money) mode. */
  players?: DevPlayers;
  /** The round notary, if notarization was enabled — stop it on shutdown to flush the last batch. */
  notary?: RoundNotary;
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

  // The chain client is decided by env once, here: real Solana when configured, the deterministic
  // fake otherwise (see chain-from-env.ts). It backs both the per-hand block reads and the notary.
  const chain = chainClientFromEnv();
  // Notarization needs a DB to persist proofs; enable it only where the process connects to one.
  const notary: RoundNotary | undefined = opts.notarize
    ? new MerkleRoundNotary(chain, new MongoMerkleStore(), { flushIntervalMs: 30_000 })
    : undefined;

  // Anchor the payout rules before any hand cites them (queue #12). Idempotent
  // on the version hash, so this is a no-op on every boot after the first with
  // unchanged rules. Fire-and-forget with its own catch: an unreachable chain
  // must not stop the tables from opening — hands stay verifiable step-by-step,
  // and the RTP feed reports the missing anchor rather than implying one.
  if (opts.notarize) {
    void ensureRuleCommitment(chain).catch((err) =>
      console.error('[rules] rule manifest not committed:', err),
    );
  }

  const anchorTableRules = (room: LiveRoom): void => {
    // Anchor THIS table's rule version — the hash its rounds will actually
    // stamp. The manifest anchor above covers platform defaults; a table on a
    // custom rake (a league room) stamps a different version, and a stamp whose
    // preimage is anchored nowhere is an opaque hash nobody can check — the
    // audit's central finding against the first cut of this feature.
    // Idempotent per version; fire-and-forget, same fail-soft rules as above.
    if (!opts.notarize) return;
    const info = (room as { getRuleInfo?: () => { rules: Parameters<typeof ensureGameRuleCommitment>[1] } }).getRuleInfo?.();
    if (!info) return; // non-poker rooms do not notarize rounds
    void ensureGameRuleCommitment(chain, info.rules).catch((err) =>
      console.error('[rules] table rules not committed:', err),
    );
  };

  const hub = new TableHub(
    { directory, fc, chain, ...(notary ? { notary } : {}) },
    verifyPlayerToken,
    opts.logSockets === false
      ? undefined
      : (event): void => {
          const who = event.playerId ? ` ${event.playerId}` : '';
          const why = event.reason ? ` (${event.reason})` : '';
          console.log(`  [socket] ${event.type}${who}${why}`);
        },
    opts.authorizeSession,
  );
  for (const table of opts.tables) anchorTableRules(hub.addTable(table));

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

  // Public fairness data for a COMPLETED round — server seed, the full deck, the round hash, and the
  // Merkle proof once its batch has committed on-chain — so anyone can run the 6-step verifier on a
  // real hand. Open by design (the numbers exist to be checked). Only settled rounds are ever
  // persisted, so this can never leak an in-progress deck. Present only when notarization is on.
  if (notary) {
    app.get('/api/live/rounds/:roundId/fairness', (req: Request, res: Response): void => {
      const roundId = req.params.roundId;
      if (typeof roundId !== 'string') {
        res.status(400).json({ error: 'bad round id' });
        return;
      }
      void getRoundFairness(roundId)
        .then((round) => {
          if (round) res.json(round);
          else res.status(404).json({ error: 'round not found' });
        })
        .catch(() => res.status(502).json({ error: 'fairness store unavailable' }));
    });
  }

  return { hub, ...(devPlayers ? { players: devPlayers } : {}), ...(notary ? { notary } : {}) };
}
