import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from './auth';
import { userStore } from '../auth/user-store';
import { scoreFor, tierOf, tierForVolume, type FindingReason } from '../players/index';
import { severityOf, labelOf } from '../ops/alert-severity';
import type { GatewayConfig } from './config';

/**
 * The admin API (SAMUEL.md task 3).
 *
 * Two layers of authority, and they answer different questions:
 *
 *   requireAuth + requireAdmin — WHO is asking, and are they ops. Identity
 *     lives here in the gateway, so this is the only place that can tell.
 *   the internal secret, added below — that the caller of financial-core is a
 *     service rather than a browser. financial-core has no idea what an
 *     administrator is, by design.
 *
 * The browser therefore never holds the internal secret and never addresses
 * financial-core directly. It presents an ops token to this router, which
 * vouches for it downstream. Nothing here reads a request's own idea of who it
 * is: `approvedBy` on a withdrawal comes from the verified token, never from
 * the body, or a second signature would be a field the client fills in.
 */
export function buildAdminRouter(config: GatewayConfig): Router {
  const r = Router();

  // Order matters: requireAdmin reads the role requireAuth wrote.
  r.use(requireAuth(config));
  r.use(requireAdmin());

  /** Call financial-core with the service secret. */
  const internal = async <T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<{ ok: true; body: T } | { ok: false; status: number; error: string }> => {
    const hasBody = init.body !== undefined;
    try {
      const upstream = await fetch(`${config.financialCoreUrl}/api/v1${path}`, {
        method: init.method ?? 'GET',
        headers: {
          'x-internal-secret': config.internalApiSecret,
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
      });
      const body: unknown = await upstream.json().catch(() => null);
      if (!upstream.ok || body === null) {
        const detail =
          body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'financial service unavailable';
        return { ok: false, status: upstream.status || 502, error: detail };
      }
      return { ok: true, body: body as T };
    } catch (err) {
      console.error('[admin] financial-core unreachable:', err);
      return { ok: false, status: 502, error: 'financial service unavailable' };
    }
  };

  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response): void => {
      fn(req, res).catch((err: unknown) => {
        console.error('[admin] route failed:', err);
        res.status(500).json({ error: 'admin request failed' });
      });
    };

  /**
   * The acting administrator, from the verified token.
   *
   * Never from the body. financial-core's internal secret proves the gateway is
   * calling but cannot say which administrator is behind it, and that is the
   * whole content of an approval — a client able to name its own approver could
   * satisfy the two-person rule single-handed.
   */
  const actor = (req: Request): string => req.player!.playerId;

  /** POST through to financial-core, with a body this layer composes. */
  const post = (
    path: string,
    body: (req: Request) => Record<string, unknown>,
  ): ((req: Request, res: Response) => void) =>
    handle(async (req, res) => {
      const result = await internal<unknown>(path.replace(':id', String(req.params.id ?? '')), {
        method: 'POST',
        body: body(req),
      });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result.body);
    });

  /** Screen 1 — Overview. Read-only platform facts. */
  r.get(
    '/overview',
    handle(async (_req, res) => {
      const result = await internal<unknown>('/internal/ops/overview');
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result.body);
    }),
  );

  /**
   * Screen 3 — Players. Search by id, nickname, email or phone.
   *
   * The search runs HERE because identity does: financial-core holds accounts
   * keyed by playerId and no personal data at all, so it cannot match a
   * nickname. This resolves names to ids locally, then asks financial-core for
   * the balances.
   *
   * A known gap, surfaced rather than hidden: Telegram players have no identity
   * document — their playerId is derived from the Telegram user id and nothing
   * is written — so they are findable by exact playerId only. The response says
   * so, because an admin searching a nickname and getting nothing should know
   * whether that means "no such player" or "not searchable that way".
   */
  const MAX_RESULTS = 50;

  r.get(
    '/players',
    handle(async (req, res) => {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (q.length < 2) {
        res.json({ players: [], truncated: false, note: 'Enter at least 2 characters.' });
        return;
      }

      // Escaped before it reaches a regex. An admin pasting a player id full of
      // regex metacharacters should get a search, not a catastrophic backtrack.
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(safe, 'i');

      const identities = await userStore.search(pattern, MAX_RESULTS + 1);
      const truncated = identities.length > MAX_RESULTS;
      const page = identities.slice(0, MAX_RESULTS);

      // An exact playerId that matched no identity is still worth looking up —
      // that is how a Telegram player is found.
      const ids = page.map((u) => u.playerId);
      if (ids.length === 0) ids.push(q);

      const balances = await internal<{ balances: Record<string, string> }>(
        '/internal/players/balances',
        { method: 'POST', body: { playerIds: ids } },
      );
      const byId = balances.ok ? balances.body.balances : {};

      res.json({
        players: ids.map((playerId) => {
          const identity = page.find((u) => u.playerId === playerId);
          return {
            playerId,
            displayName: identity?.displayName ?? null,
            email: identity?.email ?? null,
            // null, not '0.00' — no account is a different fact from no money.
            balance: byId[playerId] ?? null,
          };
        }),
        truncated,
        // Said explicitly, because a downed financial-core and a player with no
        // account both produce balance: null — and an admin reading "no
        // account" on a player who holds funds would act on the wrong fact.
        balancesUnavailable: !balances.ok,
        ...(page.length === 0
          ? { note: 'No identity matched. Telegram players are findable by exact player id only.' }
          : {}),
      });
    }),
  );

  /**
   * Screen 5 — Alerts. The seven breakers' states, plus the security log.
   *
   * The spec budgets five seconds from a CB6 trip to it appearing here
   * ("trigger CB6 → alert appears in admin panel within 5 seconds"), which the
   * client meets by polling; nothing is cached on this path.
   */
  r.get(
    '/alerts',
    handle(async (req, res) => {
      const limit = typeof req.query.limit === 'string' ? req.query.limit : '100';
      const [events, overview] = await Promise.all([
        internal<{ events: RawSecurityEvent[] }>(`/internal/ops/alerts?limit=${encodeURIComponent(limit)}`),
        internal<{ breakers: BreakerShape[] }>('/internal/ops/overview'),
      ]);

      if (!events.ok) {
        res.status(events.status).json({ error: events.error });
        return;
      }

      res.json({
        // Newest first is the storage order; kept, because an operator reads
        // an alert feed from the top and stops when they reach what they saw
        // last time.
        events: events.body.events.map((e) => ({
          ...e,
          severity: severityOf(e.event),
          label: labelOf(e.event),
        })),
        breakers: overview.ok ? overview.body.breakers : [],
      });
    }),
  );

  /**
   * Screen 2 — the withdrawal review queue.
   *
   * `approvedBy` is taken from the verified token and never from the body. The
   * internal secret proves the gateway is calling; it cannot say WHICH
   * administrator, and that is the entire content of a second signature. A
   * client able to name its own approver could satisfy the two-person rule
   * alone.
   *
   * The VIP tier is derived here, from the same ladder the player's own profile
   * uses, so the queue's filter and the player's screen cannot disagree.
   */
  r.get(
    '/withdrawals',
    handle(async (_req, res) => {
      const result = await internal<{ withdrawals: QueuedWithdrawalShape[] }>(
        '/internal/ops/withdrawals',
      );
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({
        withdrawals: result.body.withdrawals.map((w) => {
          const tier = tierForVolume(w.cumulativeEffective);
          return { ...w, vipTier: tier.tier, vipTitle: tier.title };
        }),
      });
    }),
  );

  // `approverId` is main's field name for the same thing — the named human whose
  // signature this is. Taken from the verified token, never the body.
  r.post(
    '/withdrawals/:id/approve',
    post('/internal/withdrawals/:id/approve', (req) => ({ approverId: actor(req) })),
  );

  r.post(
    '/withdrawals/:id/reject',
    post('/internal/withdrawals/:id/reject', (req) => ({
      rejectedBy: actor(req),
      reason: (req.body as { reason?: string }).reason,
    })),
  );

  /** Screen 4 — Leagues. */
  r.get(
    '/leagues',
    handle(async (_req, res) => {
      const result = await internal<unknown>('/internal/ops/leagues');
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result.body);
    }),
  );

  /**
   * League funding — the money actions.
   *
   * EVERY actor comes from the verified token, never the body. `requestedBy`,
   * `approvedBy` and `rejectedBy` are all read from req.player, so a client
   * cannot name someone else as the approver — a second signature the caller
   * fills in is not a second signature.
   *
   * financial-core's internalAuth proves the gateway is asking; it cannot tell
   * WHICH administrator, which is the whole content of an approval. This layer
   * is the only place that knows.
   */
  r.get(
    '/league-funding',
    handle(async (_req, res) => {
      const result = await internal<unknown>('/internal/league-funding');
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result.body);
    }),
  );

  r.post(
    '/league-funding/top-ups',
    post('/internal/league-funding/top-ups', (req) => ({
      leagueId: (req.body as { leagueId?: string }).leagueId,
      amount: (req.body as { amount?: string }).amount,
      requestedBy: actor(req),
    })),
  );

  r.post(
    '/league-funding/cash-outs',
    post('/internal/league-funding/cash-outs', (req) => ({
      leagueId: (req.body as { leagueId?: string }).leagueId,
      amount: (req.body as { amount?: string }).amount,
      address: (req.body as { address?: string }).address,
      requestedBy: actor(req),
    })),
  );

  r.post(
    '/league-funding/:id/approve',
    post('/internal/league-funding/:id/approve', (req) => ({ approvedBy: actor(req) })),
  );

  r.post(
    '/league-funding/:id/reject',
    post('/internal/league-funding/:id/reject', (req) => ({
      rejectedBy: actor(req),
      reason: (req.body as { reason?: string }).reason,
    })),
  );

  // The only one that moves money. The executor is named from the verified
  // token, like every other actor here — the ledger records WHO ran it.
  r.post(
    '/league-funding/:id/execute',
    post('/internal/league-funding/:id/execute', (req) => ({ executedBy: actor(req) })),
  );

  /** One player's full detail. Read-only — there is no write counterpart. */
  r.get(
    '/players/:playerId',
    handle(async (req, res) => {
      const playerId = String(req.params.playerId);
      const [detail, identity] = await Promise.all([
        internal<PlayerDetailShape>(`/internal/players/${encodeURIComponent(playerId)}`),
        userStore.byPlayerId(playerId),
      ]);

      if (!detail.ok) {
        res.status(detail.status).json({ error: detail.error });
        return;
      }

      // The reputation SCORE is derived here, from the same canonical rules the
      // player's own profile uses. A second implementation would eventually
      // disagree with what the player sees, and an admin and a player holding
      // different numbers for the same account is worse than neither having one.
      const { roundsPlayed, findings } = detail.body.reputation;
      const score = scoreFor(roundsPlayed, findings);
      const tier = tierForVolume(detail.body.volume.cumulativeEffective);

      res.json({
        ...detail.body,
        identity: identity
          ? {
              displayName: identity.displayName ?? null,
              email: identity.email ?? null,
              createdAt: identity.createdAt ?? null,
            }
          : null,
        reputation: { roundsPlayed, findings, score, band: tierOf(score) },
        vip: { tier: tier.tier, title: tier.title },
      });
    }),
  );

  return r;
}

interface RawSecurityEvent {
  id: string;
  at: string;
  event: string;
  detail: Record<string, unknown>;
}

interface BreakerShape {
  id: string;
  name: string;
  status: string;
  tripsToday: number;
  lastTripAt: string | null;
}

interface QueuedWithdrawalShape {
  withdrawalId: string;
  playerId: string;
  amount: string;
  address: string;
  state: string;
  approvals: string[];
  cumulativeEffective: number;
  requestedAt: string;
}

/** What financial-core returns for one player, before this layer derives from it. */
interface PlayerDetailShape {
  playerId: string;
  hasAccount: boolean;
  balances: { available: string; locked: string; clearing: string; total: string };
  reputation: { roundsPlayed: number; findings: FindingReason[] };
  volume: { cumulativeEffective: number; monthlyEffective: number };
}
