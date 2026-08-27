import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { FilterError } from '../lobby';
import { syncLobbyWithLiveTables } from '../lobby/live-sync';
import type { GatewayConfig } from './config';
import { buildAuthRouter } from './auth';
import { buildLobbyRouter } from './lobby-routes';
import { buildJackpotRouter } from './jackpot-routes';
import { buildLeagueRouter } from './league-routes';
import { buildAgentRouter } from './agent-routes';
import { buildAdminRouter } from './admin-routes';
import { buildMeRouter } from './me-routes';
import { buildAvatarRouter } from './avatar-routes';
import { createRedEnvelopeRouter } from './red-envelope-routes';
import { buildInternalRouter } from './internal-routes';
import { currentRuleManifest, ruleVersionFor } from '../fairness/rule-version';
import { ruleCommitment } from '../fairness/rule-commitment';
import { mountLiveTables } from '../live/mount';
import { buildLeagueTableRouter } from './league-table-routes';
import { defaultTables } from '../live/server';
import type { LobbyService } from '../lobby';

/**
 * The gateway HTTP app — the only backend surface the Mini App talks to.
 *
 * Note this is *not* `scripts/app-server.ts`, which is a demo harness serving its
 * own UI over in-memory play money with no authentication. This is the real
 * client-facing API: authenticated, and delegating every money operation to the
 * Financial Core.
 */
export function createGatewayApp(config: GatewayConfig, lobby?: LobbyService): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors(config.corsOrigins));
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'game-server-gateway' });
  });

  app.use('/auth', buildAuthRouter(config));
  app.use('/me', buildMeRouter(config));
  // Avatar images. Public and unauthenticated (see avatar-routes.ts for why) —
  // deliberately NOT under /me, which requireAuth guards wholesale.
  app.use('/avatars', buildAvatarRouter(config));
  app.use('/leagues', buildLeagueRouter(config));
  app.use('/agent', buildAgentRouter(config));
  // Admin. Guarded to role 'ops' inside the router; deliberately NOT a product tab.
  app.use('/admin', buildAdminRouter(config));
  // Service-to-service. Guarded by the shared internal secret, never a player
  // token — this is financial-core asking, not a browser.
  app.use('/internal', buildInternalRouter(config));
  // Public payout rates — open by design; the numbers exist to be checked.
  //
  // The rates come from financial-core (it owns the volume rows); the RULE
  // VERSION those rates were earned under comes from here, because the rules
  // are game-server's. Joining them is the whole feature: a rate without the
  // committed rules behind it is a number the platform asserts about itself
  // (queue #12), which is what this endpoint exists NOT to be.
  app.get('/fairness/rtp', (_req, res) => {
    void (async (): Promise<void> => {
      let rates: unknown;
      try {
        const r = await fetch(`${config.financialCoreUrl}/api/v1/fairness/rtp`);
        if (!r.ok) {
          res.status(r.status).json({ error: 'financial service unavailable' });
          return;
        }
        rates = await r.json();
      } catch {
        res.status(502).json({ error: 'financial service unavailable' });
        return;
      }

      // The stamp is best-effort ON TOP of the rates: if the commitment cannot
      // be read, publish the rates with `rules: null` rather than 502 the whole
      // feed. An absent stamp is honest; a missing feed helps nobody.
      const manifest = currentRuleManifest();
      let commitment: Awaited<ReturnType<typeof ruleCommitment>> = null;
      try {
        commitment = await ruleCommitment(manifest.version);
      } catch (err) {
        console.error('[rtp] rule commitment unreadable:', err);
      }

      res.json({
        ...(rates as Record<string, unknown>),
        rules: {
          version: manifest.version,
          manifestRevision: manifest.manifestRevision,
          // Each game carries ITS OWN version — the hash a default table of
          // that game stamps on its rounds. This is the join the audit found
          // missing: the manifest version alone could never equal any round's
          // stamp, so the published stamp was uncheckable. Now: round says Y →
          // find the game entry with version Y (or fetch /fairness/rules/Y for
          // a custom table) → re-hash the entry → Y. Anchored via the same
          // commitment store.
          games: manifest.games.map((g) => ({ ...g, version: ruleVersionFor(g) })),
          // Null txId = the rules are published but not yet anchored on-chain.
          // The UI must say which, and never imply the stronger claim.
          chainTx: commitment?.txId ?? null,
          committedAt: commitment?.committedAt ?? null,
        },
      });
    })();
  });
  // The preimage behind one rule version — what a round's stamp actually
  // hashes. Public for the same reason the rates are: the number exists to be
  // checked. 404 for an unknown version is honest (nothing was committed under
  // that hash), and the response carries the chain tx so the ordering claim —
  // rules anchored BEFORE the hands that cite them — is independently checkable.
  app.get('/fairness/rules/:version', (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const version = String(req.params.version ?? '');
      if (!/^[0-9a-f]{64}$/.test(version)) {
        res.status(400).json({ error: 'a rule version is a 64-char hex digest' });
        return;
      }
      try {
        const commitment = await ruleCommitment(version);
        if (!commitment) {
          res.status(404).json({ error: 'unknown rule version' });
          return;
        }
        res.json({
          version: commitment._id,
          manifestRevision: commitment.manifestRevision,
          manifest: commitment.manifest,
          chainTx: commitment.txId,
          committedAt: commitment.committedAt,
        });
      } catch (err) {
        console.error('[rules] commitment lookup failed:', err);
        res.status(503).json({ error: 'rule store unavailable' });
      }
    })();
  });

  // Optional so auth-only deployments (and the auth tests) don't have to stand
  // up a lobby they never read.
  // Config passed so the lobby can resolve a league context; without it the
  // router serves the public lobby only.
  if (lobby) app.use('/lobby', buildLobbyRouter(lobby, config));
  // Jackpot pools are derived from the same tables, so it shares the gate.
  if (lobby) app.use('/jackpot', buildJackpotRouter(lobby, config));

  app.use('/red-envelope', createRedEnvelopeRouter());
  // Live tables, folded into the gateway so ONE origin serves the API and the game socket (`/ws`).
  // Mounted only when the Financial Core secret is configured — i.e. a real deploy; an auth-only
  // gateway (and the auth/lobby tests) skip it. The WebSocket itself is attached to the http server
  // in gateway/server.ts, which reads `app.locals.tableHub`.
  if (config.internalApiSecret) {
    const liveTables = defaultTables();
    const mounted = mountLiveTables(app, {
      jwtSecret: config.jwtSecret,
      financialCore: { baseUrl: config.financialCoreUrl, internalSecret: config.internalApiSecret },
      tables: liveTables,
      // The gateway connects to Mongo (the user store), so it can persist round proofs — notarize here.
      notarize: true,
    });
    app.locals.tableHub = mounted.hub;

    /**
     * Point the lobby at the rooms that actually exist.
     *
     * Without this the lobby and the hub are two unrelated lists: the lobby advertised `tx-1`
     * while the hub only ever knew `texas`, so every row a player could tap answered
     * "unknown table". See src/lobby/live-sync.ts for the full account.
     *
     * Re-synced on an interval so seat counts do not freeze at whatever they were when the process
     * started. `unref()` so this timer never holds the process (or a test run) open.
     */
    if (lobby) {
      const resync = (): void =>
        syncLobbyWithLiveTables(lobby, mounted.hub.tables(), liveTables);
      resync();
      setInterval(resync, 5_000).unref();
    }

    // League private rooms (v5.9 §2). Mounted here rather than beside the other
    // league routes because it needs the hub and the lobby, which only exist
    // once live tables are mounted — and a create-table endpoint with nowhere to
    // open a table would 500 rather than refuse.
    if (lobby) {
      app.use('/leagues', buildLeagueTableRouter(config, { hub: mounted.hub, lobby }));
    }
  }

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  // Final guard: never let a stack trace reach a client.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof FilterError) {
      res.status(400).json({ error: err.message });
      return;
    }
    // body-parser's size-limit rejection (express.json's global 64kb, and the
    // avatar route's own scoped express.raw limit) throws an error with this
    // shape. Without this branch it fell through to the generic 500 below —
    // "internal error" for what is actually a well-formed, correctly-working
    // rejection of an oversized request. A client cannot tell "the server
    // broke" from "you sent too much" unless the status says which.
    if (
      err &&
      typeof err === 'object' &&
      ('type' in err ? (err as { type?: unknown }).type === 'entity.too.large' : false)
    ) {
      res.status(413).json({ error: 'request body is too large' });
      return;
    }
    const message = err instanceof Error ? err.message : 'internal error';
    console.error('[gateway] unhandled error:', message);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

/**
 * Origin allow-list. An empty list means "same-origin only" — no `*`, because the
 * client sends a bearer token and a wildcard would let any page on the internet
 * call the API with a user's credentials if it ever got hold of one.
 */
function cors(allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(origin && allowed.includes(origin) ? 204 : 403);
      return;
    }
    next();
  };
}
