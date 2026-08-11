import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Money } from '../domain/money';
import { LedgerType, LedgerDirection, PLATFORM_SCOPE } from '../domain/account-types';
import { LedgerModel } from '../wallet/ledger.model';
import { transfer } from '../wallet/transfer';
import { TableType } from '../settlement/settlement-domain';
import { settleRound } from '../settlement/settle-round';
import { settleTableHand } from '../settlement/table-settlement';
import { processConfirmedDeposit } from '../deposit/deposit-credit';
import { lockForBuyIn, releaseToAvailable } from '../wallet/seat-funds';
import {
  requestWithdrawal,
  approveWithdrawal,
  broadcastWithdrawal,
  confirmWithdrawal,
} from '../withdrawal/withdrawal-state-machine';
import { getOrCreatePlayerAccount, ensureJackpotAccounts } from '../wallet/system-accounts';
import { getInsuranceReserve } from '../wallet/insurance-reserve';
import { getDepositAddress } from '../wallet/deposit-address';
import { getWalletTransactions, getWithdrawals } from '../wallet/wallet-views';
import { isValidTronAddress } from '../wallet/tron-address';
import { getPlayerStats, getPlayerHistory } from '../stats/player-stats';
import { getSettings, updateSettings } from '../settings/player-settings';
import { getReputationFacts } from '../reputation/player-reputation';
import {
  createLeague,
  getLeague,
  joinLeague,
  leaveLeague,
  leaguesFor,
  discoverLeagues,
} from '../league/league-store';
import {
  createAgent,
  getAgent,
  createReferralLink,
  linksFor,
  bindReferral,
  playersOf,
  summaryFor,
  subAgentsOf,
  commissionBreakdown,
  commissionSeries,
  settlementRecords,
  setSubAgentRate,
} from '../agent/agent-store';
import {
  notify,
  listNotifications,
  markRead,
} from '../notifications/notification-store';
import { getVolumeFacts, recordVolume, getPublicRtp } from '../vip/volume-tracker';
import { AccountModel } from '../wallet/account.model';
import { WithdrawalModel } from '../withdrawal/withdrawal.model';
import { asyncHandler, internalAuth, dataScopeMiddleware, ApiError } from './middleware';
import { openApiSpec } from './openapi';

const money = z.string().min(1);
const accountId = z.string().min(1);

/** All FC HTTP endpoints under /api/v1. */
export function buildRouter(): Router {
  const r = Router();

  // ── Health + API docs (open) ─────────────────────────────────────────────
  r.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'financial-core' });
  });
  r.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(openApiSpec);
  });

  // ── Player-scoped (JWT) ──────────────────────────────────────────────────
  r.get(
    '/me/balance',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const playerId = req.dataScope!.playerId;
      const acc = await getOrCreatePlayerAccount(playerId);
      const available = Money.fromDecimal128(acc.availableBalance);
      const locked = Money.fromDecimal128(acc.lockedBalance);
      const clearing = Money.fromDecimal128(acc.clearingBalance);
      res.json({
        playerId,
        available: available.toString(),
        locked: locked.toString(),
        clearing: clearing.toString(),
        // Summed here with exact Money arithmetic so the client never adds
        // decimal strings as floats.
        total: available.add(locked).add(clearing).toString(),
      });
    }),
  );

  // The player's permanent TRC-20 deposit address (derived from the account xpub).
  // 200 with { configured: false } when no xpub is provisioned yet, so the client
  // can show "deposits open after chain setup" rather than treating it as an error.
  r.get(
    '/me/deposit-address',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const addr = await getDepositAddress(req.dataScope!.playerId);
      if (!addr) {
        res.json({ configured: false });
        return;
      }
      res.json({ configured: true, ...addr });
    }),
  );

  // Wallet money movements (deposits, withdrawals, bets, wins) — read-only.
  const txnQuery = z.object({ limit: z.coerce.number().int().positive().max(200).optional() });
  r.get(
    '/me/transactions',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { limit } = txnQuery.parse(req.query);
      const acc = await getOrCreatePlayerAccount(req.dataScope!.playerId);
      res.json(await getWalletTransactions(acc._id, { ...(limit !== undefined ? { limit } : {}) }));
    }),
  );

  const period = z.enum(['today', '7d', '30d', 'all']).optional();
  const statsQuery = z.object({ period });

  // Derived from the ledger — see src/stats/player-stats.ts for what is and is
  // not knowable from it. VPIP, PFR and largest-pot are deliberately absent.
  r.get(
    '/me/stats',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { period } = statsQuery.parse(req.query);
      res.json(
        await getPlayerStats(req.dataScope!.playerId, {
          ...(period !== undefined ? { period } : {}),
        }),
      );
    }),
  );

  const historyQuery = z.object({
    limit: z.coerce.number().int().positive().max(100).optional(),
    cursor: z.string().min(1).optional(),
    period,
  });
  r.get(
    '/me/history',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { limit, cursor, period: window } = historyQuery.parse(req.query);
      res.json(
        await getPlayerHistory(req.dataScope!.playerId, {
          ...(limit !== undefined ? { limit } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
          ...(window !== undefined ? { period: window } : {}),
        }),
      );
    }),
  );

  // Reputation FACTS. The score is derived by the gateway from the canonical
  // rules in game-server/src/players/reputation.ts — this service stores what
  // happened and stays out of the scoring business. Still NOT money: nothing
  // here is reachable from the withdrawal path.
  r.get(
    '/me/reputation',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await getReputationFacts(req.dataScope!.playerId));
    }),
  );

  // ── Alliances (leagues) ──────────────────────────────────────────────────
  // Membership is the isolation boundary: every league read below is scoped to
  // the caller, so a player can never enumerate a league they do not belong to.
  r.get(
    '/me/leagues',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ leagues: await leaguesFor(req.dataScope!.playerId) });
    }),
  );

  // Discovery lists only non-invite-only leagues, by definition of the store.
  r.get(
    '/leagues',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ leagues: await discoverLeagues() });
    }),
  );

  const createLeagueBody = z.object({
    leagueId: z.string().min(3).max(40),
    name: z.string().min(2).max(40),
    description: z.string().max(200).optional(),
    inviteOnly: z.boolean().optional(),
  });
  r.post(
    '/leagues',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = createLeagueBody.parse(req.body);
      const league = await createLeague({
        leagueId: body.leagueId,
        name: body.name,
        // The creator is the owner, taken from the token — never from the body,
        // which would let anyone found a league in someone else's name.
        ownerId: req.dataScope!.playerId,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.inviteOnly !== undefined ? { inviteOnly: body.inviteOnly } : {}),
      });
      res.status(201).json(league);
    }),
  );

  r.get(
    '/leagues/:leagueId',
    asyncHandler(async (req: Request, res: Response) => {
      const league = await getLeague(req.params.leagueId!);
      if (!league) throw new ApiError(404, 'no such league');
      res.json(league);
    }),
  );

  r.post(
    '/leagues/:leagueId/join',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      await joinLeague(req.params.leagueId!, req.dataScope!.playerId);
      res.json(await getLeague(req.params.leagueId!));
    }),
  );

  r.post(
    '/leagues/:leagueId/leave',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      await leaveLeague(req.params.leagueId!, req.dataScope!.playerId);
      res.status(204).end();
    }),
  );

  // ── Agent Center ─────────────────────────────────────────────────────────
  // Every route is scoped to the caller's own agency. There is deliberately no
  // way to read another agent's players, and nothing here returns a balance —
  // see src/agent/agent-store.ts for why that is structural rather than a
  // filter someone could forget to apply.
  r.get(
    '/me/agent',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const summary = await summaryFor(req.dataScope!.playerId);
      // Not an error: most players are not agents, and a 404 would make the
      // client treat an ordinary account as a failure.
      res.json({ agent: summary });
    }),
  );

  r.get(
    '/me/agent/players',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ players: await playersOf(req.dataScope!.playerId) });
    }),
  );

  // The dashboard reads take an explicit window rather than a named range like
  // "this week". Naming periods is a rule — which day a week starts on, which
  // timezone "today" means — and rules live in the gateway. This layer answers
  // for the dates it is given.
  const windowQuery = z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  });

  const parseWindow = (req: Request): { from: Date; to: Date } => {
    const { from, to } = windowQuery.parse(req.query);
    return { from: new Date(from), to: new Date(to) };
  };

  r.get(
    '/me/agent/breakdown',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await commissionBreakdown(req.dataScope!.playerId, parseWindow(req)));
    }),
  );

  r.get(
    '/me/agent/series',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ points: await commissionSeries(req.dataScope!.playerId, parseWindow(req)) });
    }),
  );

  const settlementQuery = windowQuery.extend({
    source: z.enum(['DIRECT', 'OVERRIDE']).optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
  });
  r.get(
    '/me/agent/settlements',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const q = settlementQuery.parse(req.query);
      res.json(
        await settlementRecords(req.dataScope!.playerId, {
          from: new Date(q.from),
          to: new Date(q.to),
          ...(q.source ? { source: q.source } : {}),
          ...(q.limit ? { limit: q.limit } : {}),
        }),
      );
    }),
  );

  r.get(
    '/me/agent/links',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ links: await linksFor(req.dataScope!.playerId) });
    }),
  );

  const linkBody = z.object({ label: z.string().min(1).max(40).optional() });
  r.post(
    '/me/agent/links',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { label } = linkBody.parse(req.body);
      const linkId = await createReferralLink(req.dataScope!.playerId, label);
      res.status(201).json({ linkId, label: label ?? 'default' });
    }),
  );

  r.get(
    '/me/agent/sub-agents',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ subAgents: await subAgentsOf(req.dataScope!.playerId) });
    }),
  );

  const subAgentBody = z.object({
    playerId: z.string().min(1),
    rateBps: z.number().int().nonnegative(),
  });
  r.post(
    '/me/agent/sub-agents',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const body = subAgentBody.parse(req.body);
      const parentId = req.dataScope!.playerId;
      const parent = await getAgent(parentId);
      if (!parent) throw new ApiError(403, 'not an agent');
      // The rate bounds (5% to parent minus 5%) are enforced by the gateway,
      // which owns the agent domain — see game-server/src/agents/commission.ts.
      // financial-core stores what it is told; restating the rule here would
      // give two answers to who keeps what, and they would drift.
      res.status(201).json(
        await createAgent({
          agentId: body.playerId,
          rateBps: body.rateBps,
          parentAgentId: parentId,
        }),
      );
    }),
  );

  const rateBody = z.object({ rateBps: z.number().int().nonnegative() });
  r.patch(
    '/me/agent/sub-agents/:subAgentId',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { rateBps } = rateBody.parse(req.body);
      // Bounds are the gateway's, same as creation above. This stores what it
      // is told, scoped to the caller's own sub-agents.
      await setSubAgentRate(req.dataScope!.playerId, String(req.params.subAgentId), rateBps);
      res.json({ ok: true });
    }),
  );

  // Facts for the gateway's eligibility derivation: rounds, findings, and
  // whether this player is already an agent. The 700 threshold and the scoring
  // that reaches it live gateway-side with the rest of the reputation rules.
  r.get(
    '/me/agent/eligibility',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const playerId = req.dataScope!.playerId;
      const facts = await getReputationFacts(playerId);
      res.json({ ...facts, alreadyAgent: (await getAgent(playerId)) !== null });
    }),
  );

  // Web identity (email/password + Google) for the browser build. Kept behind
  // the internal secret: only the gateway calls these.

  // Enrolment is an OPS action, not self-service. The spec routes agent
  // applications through customer service; a public endpoint would let anyone
  // clearing the numeric bar start taking a cut of the rake.
  const enrolBody = z.object({
    playerId: z.string().min(1),
    rateBps: z.number().int().nonnegative(),
  });
  r.post(
    '/internal/agents',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const body = enrolBody.parse(req.body);
      res.status(201).json(await createAgent({ agentId: body.playerId, rateBps: body.rateBps }));
    }),
  );

  const bindBody = z.object({ linkId: z.string().min(1) });
  r.post(
    '/me/referral',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { linkId } = bindBody.parse(req.body);
      // Permanent and set once — a second call is a no-op, not an update.
      await bindReferral(req.dataScope!.playerId, linkId);
      res.status(204).end();
    }),
  );

  // Public payout rates — open like /health: the whole point is that anyone
  // can read them, and the frontend reaches this through the gateway.
  r.get(
    '/fairness/rtp',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ games: await getPublicRtp() });
    }),
  );

  // ── Jackpot payout ───────────────────────────────────────────────────────
  // The clearing rules have whitelisted JACKPOT_* -> PLAYER from the start;
  // this is the first caller. transfer() runs the full guard set — whitelist,
  // idempotency, overdraft — so a pool can never pay more than it holds, and a
  // replayed trigger cannot pay twice.
  const jackpotPayoutBody = z.object({
    tableId: z.string().min(1),
    tier: z.enum(['mini', 'minor', 'major', 'grand']),
    jackpotAccountId: z.string().min(1),
    playerId: z.string().min(1),
    /** Decimal string, table currency. */
    amount: z.string().min(1),
    roundId: z.string().min(1),
  });
  r.post(
    '/internal/jackpot-payouts',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = jackpotPayoutBody.parse(req.body);
      await ensureJackpotAccounts(b.tableId, {
        mini: b.tier === 'mini' ? b.jackpotAccountId : `jp:${b.tableId}:mini`,
        minor: b.tier === 'minor' ? b.jackpotAccountId : `jp:${b.tableId}:minor`,
        major: b.tier === 'major' ? b.jackpotAccountId : `jp:${b.tableId}:major`,
        grand: b.tier === 'grand' ? b.jackpotAccountId : `jp:${b.tableId}:grand`,
      });
      const player = await getOrCreatePlayerAccount(b.playerId);
      const result = await transfer({
        fromAccountId: b.jackpotAccountId,
        toAccountId: player._id,
        amount: Money.fromDecimalString(b.amount),
        type: LedgerType.JACKPOT_PAYOUT,
        businessId: b.roundId,
        idempotencyKey: `${b.roundId}:jackpot:${b.tier}`,
        // Which tier and table this was. The idempotency key happens to contain
        // the tier, but parsing a dedup guard to recover domain data makes the
        // key's format load-bearing for a feature that has nothing to do with
        // deduplication. History reads these fields instead.
        metadata: { tier: b.tier, tableId: b.tableId },
      });
      res.json({ applied: result.applied ?? true });
    }),
  );

  /**
   * Jackpot history (spec §5: "No time limit. Player UI default: last 30 days
   * + full date-range query.").
   *
   * Read from the LEDGER, not from the jackpot engines. The engines hold their
   * hits in memory per table, so their history dies with the process and is
   * gone on the next deploy — "no time limit" cannot be served from something
   * that forgets. Every paid hit left a JACKPOT_PAYOUT credit, which is
   * permanent by construction.
   *
   * Public, like the pools themselves: recent winners are the reason anyone
   * looks at this page. Only the winning ACCOUNT id is exposed, never a balance
   * and never the rest of that player's ledger.
   */
  const jackpotHistoryQuery = z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    tier: z.enum(['mini', 'minor', 'major', 'grand']).optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
  });
  r.get(
    '/jackpot/history',
    asyncHandler(async (req: Request, res: Response) => {
      const q = jackpotHistoryQuery.parse(req.query);
      const query: Record<string, unknown> = {
        type: LedgerType.JACKPOT_PAYOUT,
        // The credit side only: the debit is the pool paying, and listing both
        // would show every win twice.
        direction: LedgerDirection.CREDIT,
      };
      if (q.tier) query['metadata.tier'] = q.tier;
      if (q.from || q.to) {
        query.createdAt = {
          ...(q.from ? { $gte: new Date(q.from) } : {}),
          ...(q.to ? { $lte: new Date(q.to) } : {}),
        };
      }

      const rows = await LedgerModel.find(query)
        .sort({ createdAt: -1 })
        .limit(q.limit ?? 50)
        .lean();

      res.json({
        hits: rows.map((r) => ({
          at: r.createdAt.toISOString(),
          tier: (r.metadata?.tier as string) ?? 'unknown',
          tableId: (r.metadata?.tableId as string) ?? null,
          roundId: r.businessId ?? null,
          accountId: r.accountId,
          amount: r.amount.toString(),
        })),
      });
    }),
  );

  /**
   * Insurance reserve FACTS for one system — `PLATFORM` or a leagueId.
   *
   * Returns balances and today's paid-out total; the RULES (§4: reserve
   * threshold $10k/$1k, single payout ≤ 5% of reserve, daily ≤ 15%) live with
   * the underwriting engine in the gateway, which is the only caller. Same
   * facts/rules split as reputation and VIP — restating the caps here would
   * give two answers to how much the pool may risk.
   *
   * This endpoint is what retires INSURANCE_RESERVE_PLACEHOLDER: quotes are
   * now arithmetic on what the pool actually holds, so the auto-disable rule
   * ("reserve < threshold → insurance entry hidden") fires on real numbers.
   */
  const reserveQuery = z.object({ ownerId: z.string().min(1) });
  r.get(
    '/internal/insurance/reserve',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { ownerId } = reserveQuery.parse(req.query);
      res.json(await getInsuranceReserve(ownerId));
    }),
  );

  // ── Notifications ────────────────────────────────────────────────────────
  const notificationsQuery = z.object({
    limit: z.coerce.number().int().positive().max(100).optional(),
    cursor: z.string().min(1).optional(),
  });
  r.get(
    '/me/notifications',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { limit, cursor } = notificationsQuery.parse(req.query);
      res.json(
        await listNotifications(req.dataScope!.playerId, {
          ...(limit !== undefined ? { limit } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
        }),
      );
    }),
  );

  const readBody = z.object({ ids: z.array(z.string().min(1)).optional() });
  r.post(
    '/me/notifications/read',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { ids } = readBody.parse(req.body ?? {});
      const marked = await markRead(req.dataScope!.playerId, ids);
      res.json({ marked });
    }),
  );

  // Raised by services, never by a player: someone who could notify themselves
  // could notify anyone, and a notification is a claim the platform is making.
  // Accepts either identifier, for the same reason as /internal/volume:
  // settlement holds account ids, and the lookup belongs here rather than in
  // every caller.
  const notifyBody = z
    .object({
      playerId: z.string().min(1).optional(),
      playerAccountId: z.string().min(1).optional(),
      kind: z.enum(['RESULT', 'DEPOSIT', 'PROMO', 'JACKPOT', 'SYSTEM']),
      titleKey: z.string().min(1),
      eventId: z.string().min(1),
      params: z.record(z.union([z.string(), z.number()])).optional(),
    })
    .refine((b) => b.playerId !== undefined || b.playerAccountId !== undefined, {
      message: 'one of playerId or playerAccountId is required',
    });
  r.post(
    '/internal/notifications',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const body = notifyBody.parse(req.body);

      let playerId = body.playerId;
      if (playerId === undefined) {
        const account = await AccountModel.findById(body.playerAccountId).lean();
        // An unknown account means no notification, which is recoverable. Never
        // worth failing a settled hand over.
        if (!account) {
          res.json({ stored: false, suppressed: false });
          return;
        }
        playerId = account.ownerId;
      }

      const stored = await notify({
        playerId,
        kind: body.kind,
        titleKey: body.titleKey,
        eventId: body.eventId,
        ...(body.params !== undefined ? { params: body.params } : {}),
      });
      // 'suppressed' is not a failure — the player asked not to be told, and the
      // caller should be able to tell that apart from an error.
      res.json({ stored, suppressed: !stored });
    }),
  );

  // ── VIP ──────────────────────────────────────────────────────────────────
  // Volume FACTS. The ladder (thresholds, titles, progress) is applied by the
  // gateway from game-server/src/players/vip.ts.
  r.get(
    '/me/vip',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await getVolumeFacts(req.dataScope!.playerId));
    }),
  );

  // The settlement hook. Called once per player per settled hand, by the game
  // server — the only place that knows which game a round belonged to.
  //
  // Deliberately NOT part of the ledger write: this is a counter beside the
  // money path, not on it. The spec describes it that way too ('VIP progress
  // logs $3', 'cumulative volume tracking'), and it means adding VIP costs
  // settlement one additive call rather than a schema change to money.
  // Accepts either identifier. Settlement holds ACCOUNT ids, not player ids —
  // requiring the latter would make every caller do a lookup financial-core can
  // do itself, and a lookup done in four places is a lookup done differently in
  // four places.
  const volumeBody = z
    .object({
      playerId: z.string().min(1).optional(),
      playerAccountId: z.string().min(1).optional(),
      gameId: z.string().min(1),
      staked: z.number().int().nonnegative(),
      won: z.number().int().nonnegative(),
    })
    .refine((b) => b.playerId !== undefined || b.playerAccountId !== undefined, {
      message: 'one of playerId or playerAccountId is required',
    });
  r.post(
    '/internal/volume',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const body = volumeBody.parse(req.body);

      let playerId = body.playerId;
      if (playerId === undefined) {
        const account = await AccountModel.findById(body.playerAccountId).lean();
        // Not an error worth failing settlement over — an unknown account means
        // no VIP progress for that player, which is recoverable. Throwing here
        // would put a counter in the way of a settled hand.
        if (!account) {
          res.status(204).end();
          return;
        }
        playerId = account.ownerId;
      }

      await recordVolume({
        playerId,
        gameId: body.gameId,
        staked: body.staked,
        won: body.won,
      });
      res.status(204).end();
    }),
  );

  // Preferences. Deliberately NOT money — no transaction, no balance, and
  // nothing here may ever gate a withdrawal.
  r.get(
    '/me/settings',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await getSettings(req.dataScope!.playerId));
    }),
  );

  const settingsBody = z.object({
    // Explicit null clears the override and returns the player to following
    // their Telegram language, which is different from "leave unchanged".
    language: z.string().min(2).max(12).nullable().optional(),
    sound: z.boolean().optional(),
    haptics: z.boolean().optional(),
    notifyResults: z.boolean().optional(),
    notifyDeposits: z.boolean().optional(),
    notifyPromos: z.boolean().optional(),
  });
  r.patch(
    '/me/settings',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const patch = settingsBody.parse(req.body);
      res.json(await updateSettings(req.dataScope!.playerId, patch));
    }),
  );

  // A player's own withdrawals with their lifecycle state — read-only status view.
  r.get(
    '/me/withdrawals',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { limit } = txnQuery.parse(req.query);
      const acc = await getOrCreatePlayerAccount(req.dataScope!.playerId);
      res.json(await getWithdrawals(acc._id, { ...(limit !== undefined ? { limit } : {}) }));
    }),
  );

  const withdrawalBody = z.object({ amount: money, address: z.string().min(1) });
  r.post(
    '/me/withdrawals',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { amount, address } = withdrawalBody.parse(req.body);
      // Reject a malformed TRON address here — before any state is created — so a
      // typo can never reach the broadcast step. (Reputation/anti-bot must NOT
      // gate withdrawals, iron rule #3; a checksum is address hygiene, not a gate.)
      if (!isValidTronAddress(address)) throw new ApiError(400, 'invalid TRON address');
      const acc = await getOrCreatePlayerAccount(req.dataScope!.playerId);
      const withdrawalId = await requestWithdrawal({
        playerAccountId: acc._id,
        amount: Money.fromDecimalString(amount),
        address,
      });
      res.status(201).json({ withdrawalId, state: 'REQUESTED' });
    }),
  );

  // ── Internal service endpoints (shared secret) ───────────────────────────
  const depositBody = z.object({
    playerId: z.string().min(1),
    amount: money,
    txHash: z.string().min(1),
    contractAddress: z.string().min(1),
    confirmations: z.number().int().nonnegative(),
  });
  r.post(
    '/internal/deposits',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const body = depositBody.parse(req.body);
      const acc = await getOrCreatePlayerAccount(body.playerId);
      const outcome = await processConfirmedDeposit({
        playerAccountId: acc._id,
        amount: Money.fromDecimalString(body.amount),
        txHash: body.txHash,
        contractAddress: body.contractAddress,
        confirmations: body.confirmations,
      });
      res.json(outcome);
    }),
  );

  // Resolve a player's account id for money movement. Per the spec the account `_id` is a UUID and
  // `owner_id` is the playerId, and the money layer keys by `_id`; callers pass the playerId (what
  // the platform holds), so we resolve it to the account here. Scoping by table type is also what
  // enforces Platform/League dual-wallet isolation — the same player is a DIFFERENT account inside a
  // league, so a league hand can never touch platform funds and vice-versa.
  function playerScope(tableType: TableType | undefined, leagueId: string | undefined): string {
    if (tableType === TableType.LEAGUE) {
      if (!leagueId) throw new ApiError(400, 'leagueId is required for a LEAGUE table');
      return leagueId;
    }
    return PLATFORM_SCOPE;
  }
  async function resolvePlayerAccountId(playerId: string, scope: string): Promise<string> {
    return (await getOrCreatePlayerAccount(playerId, scope))._id;
  }

  const settleBody = z.object({
    roundId: z.string().min(1),
    tableType: z.nativeEnum(TableType),
    leagueId: z.string().min(1).optional(),
    winnerAccountId: accountId,
    winnerProfit: money,
    rake: money,
    jackpotAccounts: z.object({
      mini: accountId,
      minor: accountId,
      major: accountId,
      grand: accountId,
    }),
  });
  r.post(
    '/internal/settlements',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = settleBody.parse(req.body);
      const winnerAccountId = await resolvePlayerAccountId(
        b.winnerAccountId,
        playerScope(b.tableType, b.leagueId),
      );
      const receipt = await settleRound({
        roundId: b.roundId,
        tableType: b.tableType,
        ...(b.leagueId ? { leagueId: b.leagueId } : {}),
        winnerAccountId,
        winnerProfit: Money.fromDecimalString(b.winnerProfit),
        rake: Money.fromDecimalString(b.rake),
        jackpotAccounts: b.jackpotAccounts,
      });
      res.json(receipt);
    }),
  );

  const party = z.object({ playerAccountId: accountId, amount: money });
  const tableSettleBody = z.object({
    roundId: z.string().min(1),
    tableType: z.nativeEnum(TableType),
    leagueId: z.string().min(1).optional(),
    losers: z.array(party),
    winners: z.array(party),
    rake: money,
    jackpot: z.object({ mini: money, minor: money, major: money, grand: money }),
    jackpotAccounts: z.object({
      mini: accountId,
      minor: accountId,
      major: accountId,
      grand: accountId,
    }),
  });
  r.post(
    '/internal/table-settlements',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = tableSettleBody.parse(req.body);
      // The pools must exist before the injection credits them — transfer()
      // throws AccountNotFoundError otherwise, failing the whole settlement.
      // The owning table is read from the pool id itself (`jp:<table>:mini`) —
      // round ids use dashes, so splitting THEM on ':' yielded the whole round
      // id as an owner. Unknown id shapes fall back to the round id, which is
      // at least traceable.
      const tableOwner = b.jackpotAccounts.mini.split(':')[1] || b.roundId;
      await ensureJackpotAccounts(tableOwner, b.jackpotAccounts);
      const m = (s: string): Money => Money.fromDecimalString(s);
      // Each party is a playerId (owner_id); resolve to its account _id in the table's scope before
      // the ledger, which keys by _id. The scope routes a league hand to the player's league wallet.
      const scope = playerScope(b.tableType, b.leagueId);
      const losers = await Promise.all(
        b.losers.map(async (l) => ({ accountId: await resolvePlayerAccountId(l.playerAccountId, scope), amount: m(l.amount) })),
      );
      const winners = await Promise.all(
        b.winners.map(async (w) => ({ accountId: await resolvePlayerAccountId(w.playerAccountId, scope), amount: m(w.amount) })),
      );
      const result = await settleTableHand({
        roundId: b.roundId,
        tableType: b.tableType,
        ...(b.leagueId ? { leagueId: b.leagueId } : {}),
        losers,
        winners,
        rake: m(b.rake),
        jackpot: {
          mini: m(b.jackpot.mini),
          minor: m(b.jackpot.minor),
          major: m(b.jackpot.major),
          grand: m(b.jackpot.grand),
        },
        jackpotAccounts: b.jackpotAccounts,
      });
      res.json(result);
    }),
  );

  // playerAccountId is a playerId (owner_id); tableType/leagueId select the scope so the buy-in
  // locks the SAME account settlement will pay from. Absent → PLATFORM, matching a platform table.
  const seatBody = z.object({
    playerAccountId: accountId,
    amount: money,
    tableType: z.nativeEnum(TableType).optional(),
    leagueId: z.string().min(1).optional(),
  });
  r.post(
    '/internal/buy-ins',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = seatBody.parse(req.body);
      const id = await resolvePlayerAccountId(b.playerAccountId, playerScope(b.tableType, b.leagueId));
      await lockForBuyIn(id, Money.fromDecimalString(b.amount));
      res.json({ ok: true });
    }),
  );
  r.post(
    '/internal/releases',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = seatBody.parse(req.body);
      const id = await resolvePlayerAccountId(b.playerAccountId, playerScope(b.tableType, b.leagueId));
      await releaseToAvailable(id, Money.fromDecimalString(b.amount));
      res.json({ ok: true });
    }),
  );

  // A player's balance by account id, for the live-table server's buy-in pre-check. Internal
  // (service-secret) — unlike /me/balance it is not JWT-scoped, because the caller is the table
  // service acting on a token it already verified. Creates a zero account on first sight, so a
  // brand-new player reads ₮0 rather than 404.
  r.get(
    '/internal/accounts/:id/balance',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const id = accountId.parse(req.params.id);
      const acc = await getOrCreatePlayerAccount(id);
      res.json({
        accountId: id,
        available: Money.fromDecimal128(acc.availableBalance).toString(),
        locked: Money.fromDecimal128(acc.lockedBalance).toString(),
        clearing: Money.fromDecimal128(acc.clearingBalance).toString(),
      });
    }),
  );

  // ── Withdrawal lifecycle (internal / ops) ────────────────────────────────
  async function currentState(id: string): Promise<string> {
    const w = await WithdrawalModel.findById(id);
    if (!w) throw new ApiError(404, `withdrawal not found: ${id}`);
    return w.state;
  }

  r.post(
    '/internal/withdrawals/:id/approve',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      await approveWithdrawal(req.params.id as string);
      res.json({ state: await currentState(req.params.id as string) });
    }),
  );
  const broadcastBody = z.object({ txHash: z.string().min(1) });
  r.post(
    '/internal/withdrawals/:id/broadcast',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { txHash } = broadcastBody.parse(req.body);
      await broadcastWithdrawal(req.params.id as string, txHash);
      res.json({ state: await currentState(req.params.id as string) });
    }),
  );
  r.post(
    '/internal/withdrawals/:id/confirm',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      await confirmWithdrawal(req.params.id as string);
      res.json({ state: await currentState(req.params.id as string) });
    }),
  );

  return r;
}
