import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from './auth';
import { userStore, type AdminUserPatch } from '../auth/user-store';
import { adminAudit, changedFields, withAuditTransaction } from '../auth/admin-audit-store';
import { defaultSuspensionGate } from '../auth/suspension-gate';
import {
  validateDisplayName,
  validateEmailAddress,
  validatePasswordStrength,
} from '../auth/credential-rules';
import { scoreFor, tierOf, tierForVolume, type FindingReason } from '../players/index';
import { MIN_SCORE, MAX_SCORE } from '../players/reputation';
import { VIP_TIERS, vipSpec, type VipTier } from '../players/vip';
import { overrideStore } from '../players/override-store';
import { severityOf, labelOf } from '../ops/alert-severity';
import type { GatewayConfig } from './config';

/**
 * Is this a tier the ladder actually defines?
 *
 * A type guard rather than a cast: an override arrives from a request body, and
 * a tier of `'V9'` would sail through a cast and then throw inside `vipSpec`,
 * which indexes the ladder by position.
 */
function isVipTier(value: unknown): value is VipTier {
  return typeof value === 'string' && VIP_TIERS.some((t) => t.tier === value);
}

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

  // Take an APPROVED withdrawal on-chain — sign + broadcast from the hot wallet.
  // No actor in the body: the approval already recorded who authorised it; this
  // is the mechanical broadcast of a decision already made and audited. On a
  // missing hot-wallet key financial-core answers 500 and the withdrawal stays
  // APPROVED for a retry, which surfaces to the admin as a failed send.
  r.post(
    '/withdrawals/:id/send',
    post('/internal/withdrawals/:id/sign-broadcast', () => ({})),
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
   * One league in full — for the admin drill-into-a-club view. financial-core
   * returns the roster + settings + money; this adds the email/nickname it alone
   * holds, for the owner and every member, in one batched lookup.
   */
  r.get(
    '/leagues/:id',
    handle(async (req, res) => {
      const result = await internal<LeagueDetailShape>(
        `/internal/ops/leagues/${encodeURIComponent(String(req.params.id))}`,
      );
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      const league = result.body;
      const identities = await userStore.byPlayerIds([
        league.ownerId,
        ...league.members.map((m) => m.playerId),
      ]);
      const named = (playerId: string): { displayName: string | null; email: string | null } => {
        const id = identities.get(playerId);
        return { displayName: id?.displayName ?? null, email: id?.email ?? null };
      };
      res.json({
        ...league,
        owner: { playerId: league.ownerId, ...named(league.ownerId) },
        members: league.members.map((m) => ({ ...m, ...named(m.playerId) })),
      });
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
      const computedScore = scoreFor(roundsPlayed, findings);
      const computedTier = tierForVolume(detail.body.volume.cumulativeEffective);

      // Both the computed value and the override are returned, so the form can
      // show what the player WOULD have and what an administrator decided
      // instead. Showing only the effective number would make an override
      // invisible the moment the page reloaded, and there would be no way to
      // tell a granted tier from an earned one.
      const override = await overrideStore.get(playerId);
      const score = override?.reputationScore ?? computedScore;
      // The title comes from `vipSpec`, never stored alongside the tier, so an
      // override cannot produce a tier whose name disagrees with its privileges.
      const effectiveTier = isVipTier(override?.vipTier) ? override!.vipTier! : computedTier.tier;
      const effectiveSpec = vipSpec(effectiveTier as VipTier);

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
        vip: { tier: effectiveSpec.tier, title: effectiveSpec.title },
        override: {
          reputationScore: override?.reputationScore ?? null,
          vipTier: override?.vipTier ?? null,
          computedScore,
          computedTier: computedTier.tier,
          setBy: override?.setBy ?? null,
          reason: override?.reason ?? null,
          at: override?.at ?? null,
        },
      });
    }),
  );

  /**
   * ── Editing a user ────────────────────────────────────────────────────────
   *
   * Everything below is a write, and everything below is audited. Three rules
   * hold across all of them, and they are the reason this surface is safe to
   * hand an administrator:
   *
   *  1. The acting admin comes from `actor(req)` — the verified token — never
   *     the body. Same rule as `approvedBy` on a withdrawal.
   *  2. Every write records a before/after pair in the admin audit log, and the
   *     audit write is AWAITED. An action taken with no record of it is the one
   *     outcome this whole surface exists to prevent.
   *  3. Validation is the SAME function the player's own self-service route
   *     calls. An admin form with a looser rule is how a display name of 900
   *     characters or an unreachable email address gets onto a live account.
   *
   * Two fields are deliberately absent, and both are specification, not
   * caution:
   *
   *  - BALANCE. "DBA direct balance update attempt → MongoDB RBAC rejects
   *    (permission denied logged)" (12-week plan, acceptance criteria). Money
   *    moves through `transfer()` and leaves a double-entry pair; a figure typed
   *    into a form leaves a balance no ledger explains, which
   *    `scripts/ledger-integrity.ts` would then report as a real discrepancy.
   *  - WITHDRAWAL ADDRESS. "Withdrawal address modification: 48-hour cooldown,
   *    player must execute via link (CS cannot directly modify)", asserted as
   *    "CS attempt to modify withdrawal address via API: 403 Forbidden". An
   *    admin who can retarget a payout address is the entire threat model of an
   *    insider attack on a poker platform.
   */

  /**
   * Override a DERIVED value — reputation score or VIP tier.
   *
   * The owner asked for these to be editable. They are computed, not stored, so
   * this records a decision beside the computation rather than rewriting the
   * facts underneath it: rounds played, findings and settled volume stay
   * exactly as the ledger says. A profile that contradicts its own history is
   * the same failure as a balance no ledger entry explains.
   *
   * A REASON IS REQUIRED. Every other admin write treats it as optional, and
   * this one does not: an override has no evidence behind it by definition —
   * there is no round, no settlement, no deposit to point at — so the sentence
   * an administrator writes is the entire record of why the number is what it
   * is. Six months later it is all anyone has.
   *
   * `null` clears a field and returns the player to their computed value, so
   * nothing here is destructive.
   */
  r.post(
    '/players/:playerId/override',
    handle(async (req, res) => {
      const playerId = String(req.params.playerId);
      const body = (req.body ?? {}) as {
        reputationScore?: unknown;
        vipTier?: unknown;
        reason?: unknown;
      };

      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!reason) {
        res.status(400).json({ error: 'a reason is required for an override', code: 'reason_required' });
        return;
      }

      const patch: { reputationScore?: number | null; vipTier?: string | null } = {};

      if (body.reputationScore !== undefined) {
        if (body.reputationScore === null) {
          patch.reputationScore = null;
        } else if (
          typeof body.reputationScore === 'number' &&
          Number.isInteger(body.reputationScore) &&
          body.reputationScore >= MIN_SCORE &&
          body.reputationScore <= MAX_SCORE
        ) {
          patch.reputationScore = body.reputationScore;
        } else {
          // FROM THE CONSTANTS, not a number written here. Reputation is a
          // 0–1000 scale (v5.9 §10.1); an earlier draft of this bound guessed
          // 0–100, which silently made every allowed value a failing one — 95
          // on a 1000-point scale is VERY_POOR, so "set their score to 95"
          // read as a promotion and delivered the worst band on the platform.
          res
            .status(400)
            .json({ error: `reputationScore must be an integer ${MIN_SCORE}–${MAX_SCORE}, or null` });
          return;
        }
      }

      if (body.vipTier !== undefined) {
        if (body.vipTier === null) {
          patch.vipTier = null;
        } else if (isVipTier(body.vipTier)) {
          patch.vipTier = body.vipTier;
        } else {
          res.status(400).json({ error: `vipTier must be one of ${VIP_TIERS.map((t) => t.tier).join(', ')}, or null` });
          return;
        }
      }

      if (patch.reputationScore === undefined && patch.vipTier === undefined) {
        res.status(400).json({ error: 'nothing to change' });
        return;
      }

      /*
       * Refuse an override for a player who does not exist.
       *
       * Checked against FINANCIAL-CORE, not the user store, and that difference
       * is the whole point. The neighbouring routes (`/suspension`,
       * `/password`, `/account`) check the user store because they edit
       * identity fields — a username, an address, a password — which a Telegram
       * player genuinely does not have.
       *
       * Reputation and VIP are not identity. A Telegram player earns both by
       * playing, and has no user-store record at all, so copying the
       * neighbours' check would refuse an override for every Telegram player on
       * the platform: a cosmetic inconsistency traded for a real exclusion of
       * probably the larger population.
       *
       * Without any check, a typo'd id writes an override document keyed to
       * nobody — inert, but it would apply silently if that id ever became a
       * real player.
       */
      const exists = await internal<{ playerId: string }>(
        `/internal/players/${encodeURIComponent(playerId)}`,
      );
      if (!exists.ok) {
        // 404 means no such player. Anything else is financial-core failing,
        // and must not be reported as "that player does not exist" — an admin
        // would conclude they had the wrong id and go looking for a second one.
        const status = exists.status === 404 ? 404 : exists.status;
        res.status(status).json({
          error: exists.status === 404 ? 'no such player' : exists.error,
          ...(exists.status === 404 ? { code: 'no_such_player' } : {}),
        });
        return;
      }

      // An override has no evidence behind it but the reason written here, so
      // losing the entry would leave a number nobody can account for at all.
      const { after } = await withAuditTransaction(async (session) => {
        const outcome = await overrideStore.set(playerId, patch, actor(req), reason, session);

        await adminAudit.record(
          {
            actorPlayerId: actor(req),
            subjectPlayerId: playerId,
            action: 'user.override',
            before: {
              reputationScore: outcome.before?.reputationScore ?? null,
              vipTier: outcome.before?.vipTier ?? null,
            },
            after: {
              reputationScore: outcome.after?.reputationScore ?? null,
              vipTier: outcome.after?.vipTier ?? null,
            },
            reason,
          },
          session,
        );
        return outcome;
      });

      res.json({
        reputationScore: after?.reputationScore ?? null,
        vipTier: after?.vipTier ?? null,
        setBy: after?.setBy ?? null,
        reason: after?.reason ?? null,
        at: after?.at ?? null,
      });
    }),
  );

  /** What an administrator may see and edit about one account. */
  r.get(
    '/players/:playerId/account',
    handle(async (req, res) => {
      const record = await userStore.adminGet(String(req.params.playerId));
      if (!record) {
        // Not an error: a Telegram player genuinely has no identity document.
        // Said in words, because "null" and "failed to load" look identical in
        // a UI that does not distinguish them.
        res.status(404).json({
          error: 'no web identity for this player',
          code: 'no_identity',
          note: 'Telegram players have no identity record — nothing here is editable for them.',
        });
        return;
      }
      res.json(record);
    }),
  );

  /** The audit trail for one account. Read-only; there is no delete path. */
  r.get(
    '/players/:playerId/audit',
    handle(async (req, res) => {
      const entries = await adminAudit.forSubject(String(req.params.playerId), 100);
      res.json({ entries });
    }),
  );

  /**
   * Edit the identity fields.
   *
   * CHANGING AN EMAIL RESETS CONFIRMATION unless the admin explicitly says
   * otherwise. Carrying `emailVerified: true` across an address change would
   * mark an address confirmed that nobody has ever proved control of — the
   * admin typed it, which is not the same thing. The override exists because
   * support legitimately needs it (a player who changed provider and can prove
   * identity another way), but it has to be asked for.
   */
  r.patch(
    '/players/:playerId',
    handle(async (req, res) => {
      const playerId = String(req.params.playerId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: AdminUserPatch = {};

      if (body.displayName !== undefined) {
        if (typeof body.displayName !== 'string') {
          res.status(400).json({ error: 'displayName must be a string' });
          return;
        }
        const verdict = validateDisplayName(body.displayName);
        if (!verdict.ok) {
          res.status(400).json({ error: verdict.message, code: verdict.code });
          return;
        }
        patch.displayName = verdict.displayName;
      }

      if (body.email !== undefined) {
        if (body.email === null) {
          patch.email = null;
        } else if (typeof body.email === 'string') {
          const verdict = validateEmailAddress(body.email.trim());
          if (!verdict.ok) {
            res.status(400).json({ error: verdict.message, code: verdict.code });
            return;
          }
          patch.email = body.email.trim();
        } else {
          res.status(400).json({ error: 'email must be a string or null' });
          return;
        }
      }

      if (body.phone !== undefined) {
        if (body.phone === null) patch.phone = null;
        else if (typeof body.phone === 'string') patch.phone = body.phone;
        else {
          res.status(400).json({ error: 'phone must be a string or null' });
          return;
        }
      }

      if (body.role !== undefined) {
        // Only the two the document can actually hold. `league_admin` exists in
        // the token type but nothing grants or reads it yet, and offering a role
        // that confers nothing is a control an admin would reasonably expect to
        // do something.
        if (body.role !== 'player' && body.role !== 'ops') {
          res.status(400).json({ error: 'role must be player or ops' });
          return;
        }
        patch.role = body.role;
      }

      if (typeof body.emailVerified === 'boolean') {
        patch.emailVerified = body.emailVerified;
      } else if (patch.email !== undefined && patch.email !== null) {
        // The address changed and the admin did not speak to confirmation —
        // so it is unconfirmed. See the route comment.
        patch.emailVerified = false;
      }

      // The write and its audit entry commit together or not at all. Applied
      // first and logged second, a failed log left the change live with no
      // record of it — the one state the audit log exists to make impossible.
      const result = await withAuditTransaction(async (session) => {
        const outcome = await userStore.adminUpdate(playerId, patch, session);
        if (!outcome.ok) return outcome;

        const diff = changedFields(
          outcome.before as unknown as Record<string, unknown>,
          outcome.after as unknown as Record<string, unknown>,
        );

        // Only write an audit entry when something actually moved. A log full of
        // no-op saves is a log nobody scrolls through, and the entries that
        // matter are the ones lost in it.
        if (Object.keys(diff.after).length > 0) {
          await adminAudit.record(
            {
              actorPlayerId: actor(req),
              subjectPlayerId: playerId,
              action: 'user.update',
              before: diff.before,
              after: diff.after,
              ...(typeof body.reason === 'string' && body.reason.trim()
                ? { reason: body.reason.trim() }
                : {}),
            },
            session,
          );
        }
        return outcome;
      });

      if (!result.ok) {
        const status = result.reason === 'no_account' ? 404 : 409;
        res.status(status).json({ error: result.reason, code: result.reason });
        return;
      }

      // AFTER the commit, never inside it. Priming a cache from within a
      // transaction that then rolls back would leave the process believing a
      // role change that never landed.
      if (patch.role !== undefined) {
        defaultSuspensionGate.primeRole(playerId, result.after.role === 'ops');
      }

      res.json(result.after);
    }),
  );

  /**
   * Suspend or reinstate.
   *
   * Its own route rather than a field on the patch above, so the acting
   * administrator is recorded ON THE ACCOUNT (`suspendedBy`) and not only in the
   * audit log. The first question about a locked-out player is who locked them
   * out, and it should be answerable from the record in front of you.
   */
  r.post(
    '/players/:playerId/suspension',
    handle(async (req, res) => {
      const playerId = String(req.params.playerId);
      const body = (req.body ?? {}) as { suspended?: unknown; reason?: unknown };

      if (typeof body.suspended !== 'boolean') {
        res.status(400).json({ error: 'suspended must be true or false' });
        return;
      }

      // An administrator suspending themselves locks the panel behind an account
      // that can no longer sign in to unlock it. Refused here rather than
      // discovered afterwards.
      if (body.suspended && playerId === actor(req)) {
        res.status(400).json({
          error: 'you cannot suspend your own account',
          code: 'self_suspend',
        });
        return;
      }

      const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined;

      // Suspension and its audit entry commit together. A ban applied with no
      // record of who issued it is the one outcome this log exists to prevent.
      const result = await withAuditTransaction(async (session) => {
        const outcome = await userStore.adminSetSuspended(
          playerId,
          body.suspended as boolean,
          actor(req),
          reason,
          session,
        );
        if (!outcome) return null;

        await adminAudit.record(
          {
            actorPlayerId: actor(req),
            subjectPlayerId: playerId,
            action: body.suspended ? 'user.suspend' : 'user.reinstate',
            before: { suspendedAt: outcome.before.suspendedAt },
            after: { suspendedAt: outcome.after.suspendedAt },
            ...(reason ? { reason } : {}),
          },
          session,
        );
        return outcome;
      });

      if (!result) {
        res.status(404).json({ error: 'no web identity for this player', code: 'no_identity' });
        return;
      }

      // Primed AFTER the commit. Inside the transaction, a rollback would leave
      // this process enforcing a suspension the database never recorded.
      //
      // It takes effect NOW rather than when the cache next expires: without it
      // an administrator watches a suspended cheat keep playing for the length
      // of a TTL and reasonably concludes the button did nothing.
      defaultSuspensionGate.prime(playerId, body.suspended);

      res.json(result.after);
    }),
  );

  /**
   * Set a password on behalf of a player.
   *
   * The new password is read from the body, hashed, and never returned, logged
   * or stored in the audit entry — the entry records THAT a password was set and
   * by whom, which is the auditable fact. Writing the value would put a live
   * credential in a collection built to be read by people.
   */
  r.post(
    '/players/:playerId/password',
    handle(async (req, res) => {
      const playerId = String(req.params.playerId);
      const body = (req.body ?? {}) as { newPassword?: unknown; reason?: unknown };

      if (typeof body.newPassword !== 'string') {
        res.status(400).json({ error: 'newPassword is required' });
        return;
      }
      const verdict = validatePasswordStrength(body.newPassword);
      if (!verdict.ok) {
        res.status(400).json({ error: verdict.message, code: verdict.code });
        return;
      }

      // Of all four writes this is the one where a lost audit entry matters
      // most: a password changed with no record of who changed it is
      // indistinguishable from an account takeover.
      const result = await withAuditTransaction(async (session) => {
        const outcome = await userStore.adminSetPassword(
          playerId,
          body.newPassword as string,
          session,
        );
        if (!outcome.ok) return outcome;

        await adminAudit.record(
          {
            actorPlayerId: actor(req),
            subjectPlayerId: playerId,
            action: 'user.set_password',
            ...(typeof body.reason === 'string' && body.reason.trim()
              ? { reason: body.reason.trim() }
              : {}),
          },
          session,
        );
        return outcome;
      });

      if (!result.ok) {
        const status = result.reason === 'no_account' ? 404 : 400;
        res.status(status).json({ error: result.reason, code: result.reason });
        return;
      }

      res.json({ ok: true });
    }),
  );

  /**
   * Screen 3b — the full Users list. THE UNION of two populations.
   *
   * Neither source alone is the user base, and the list used to be only the
   * first:
   *
   *   financial-core's players — every account money has touched. Includes
   *     Telegram players, who have no identity document at all and are
   *     reachable no other way.
   *   the gateway's user store — every web registration. Includes accounts that
   *     have never deposited or played, which financial-core has never heard of.
   *
   * Built from the first alone, the screen was the INTERSECTION in practice: a
   * fresh sign-up was invisible until they touched money. Someone could
   * register, fail to get in, contact support, and be told no such account
   * exists — and new sign-ups are exactly who support is asked about first.
   *
   * `balance: null` on an identity-only row is a fact, not a gap: there is no
   * financial account yet. The client already renders null as "no account"
   * rather than as zero, which is the distinction that matters.
   */
  const USERS_LIMIT = 200;

  r.get(
    '/users',
    handle(async (req, res) => {
      const requested = Number(req.query.limit);
      const limit =
        Number.isFinite(requested) && requested > 0 ? Math.min(requested, USERS_LIMIT) : USERS_LIMIT;

      // Both sides in parallel — one is over HTTP, the other is a local query,
      // and running them in sequence would pay the network cost for nothing.
      const [result, identities] = await Promise.all([
        internal<{ players: PlayerListShape[]; truncated: boolean }>(
          `/internal/ops/players?limit=${limit}`,
        ),
        userStore.listIdentities(limit + 1),
      ]);

      if (!result.ok) {
        // financial-core being down is NOT a reason to show an identity-only
        // list with every balance blank — an admin reading "no account" against
        // a player who holds funds would act on the wrong fact. Fail loudly.
        res.status(result.status).json({ error: result.error });
        return;
      }

      const byId = new Map(identities.map((i) => [i.playerId, i]));
      const seen = new Set<string>();

      /** A row from either source. The money fields are null when there is no account. */
      interface UserRow {
        playerId: string;
        displayName: string | null;
        email: string | null;
        balance: string | null;
        available: string | null;
        joinedAt: string;
      }

      const rows: UserRow[] = result.body.players.map((p) => {
        seen.add(p.playerId);
        const identity = byId.get(p.playerId);
        return {
          playerId: p.playerId,
          displayName: identity?.displayName ?? null,
          email: identity?.email ?? null,
          balance: p.balance,
          available: p.available,
          joinedAt: p.joinedAt,
        };
      });

      for (const i of identities) {
        if (seen.has(i.playerId)) continue;
        rows.push({
          playerId: i.playerId,
          displayName: i.displayName ?? null,
          email: i.email ?? null,
          // null, never '0' — no account is a different fact from an empty one.
          balance: null,
          available: null,
          joinedAt: i.createdAt,
        });
      }

      // Newest first, across both sources, on the one field they share.
      rows.sort((a, b) => (a.joinedAt < b.joinedAt ? 1 : a.joinedAt > b.joinedAt ? -1 : 0));

      res.json({
        users: rows.slice(0, limit),
        // Truncated if EITHER source had more. Said honestly rather than
        // inferred from the merged length, which can be short of the limit
        // while one source was still cut off.
        truncated: result.body.truncated || identities.length > limit || rows.length > limit,
      });
    }),
  );

  /**
   * Admins — list and create platform administrators.
   *
   * Gated by requireAdmin like everything here, so only an existing ops account
   * can mint another (the default seed is the bootstrap; real admins are made
   * here). Email + password only — an admin never signs in with Telegram or
   * Google — and the new account carries role 'ops' from creation.
   */
  r.get(
    '/admins',
    handle(async (_req, res) => {
      res.json({ admins: await userStore.listAdmins() });
    }),
  );

  r.post(
    '/admins',
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, string>;
      const email = (body.email ?? '').trim();
      const password = body.password ?? '';
      if (!email || !password) {
        res.status(400).json({ error: 'email and password are required' });
        return;
      }
      try {
        const admin = await userStore.createAdmin(email, password, body.displayName);
        res.json({ admin });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'could not create admin' });
      }
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

/** One player row as financial-core returns it, before this layer adds identity. */
interface PlayerListShape {
  playerId: string;
  available: string;
  balance: string;
  joinedAt: string;
}

/** One league in full, from financial-core, before this layer adds identities. */
interface LeagueDetailShape {
  leagueId: string;
  name: string;
  ownerId: string;
  memberCount: number;
  inviteOnly: boolean;
  inventory: string;
  rake: string;
  insurance: string;
  createdAt: string;
  description: string | null;
  settings: { rakeBps: number; tableHours: number; buyIn: number; spectatorsAllowed: boolean } | null;
  pendingRakeChange: { rakeBps: number; effectiveAt: string } | null;
  members: { playerId: string; role: string; joinedAt: string }[];
}

/** What financial-core returns for one player, before this layer derives from it. */
interface PlayerDetailShape {
  playerId: string;
  hasAccount: boolean;
  balances: { available: string; locked: string; clearing: string; total: string };
  reputation: { roundsPlayed: number; findings: FindingReason[] };
  volume: { cumulativeEffective: number; monthlyEffective: number };
}
