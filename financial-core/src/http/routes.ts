import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Money } from '../domain/money';
import { LedgerType, LedgerDirection, PLATFORM_SCOPE } from '../domain/account-types';
import { LedgerModel } from '../wallet/ledger.model';
import { transfer } from '../wallet/transfer';
import { TableType, getRakeDestination } from '../settlement/settlement-domain';
import { settleRound } from '../settlement/settle-round';
import { settleTableHand } from '../settlement/table-settlement';
import { processConfirmedDeposit } from '../deposit/deposit-credit';
import { lockForBuyIn, releaseToAvailable } from '../wallet/seat-funds';
import {
  requestWithdrawal,
  approveWithdrawal,
  broadcastWithdrawal,
  confirmWithdrawal,
  rollbackWithdrawal,
} from '../withdrawal/withdrawal-state-machine';
import { signAndBroadcastWithdrawal } from '../withdrawal/withdrawal-broadcast';
import { evaluateCB3, evaluateCB4, evaluateCB5 } from '../circuit-breakers/breakers';
import {
  setWithdrawalAddress,
  getWithdrawalAddress,
  assertWithdrawableAddress,
  withdrawableAt,
  WithdrawalAddressError,
} from '../withdrawal/withdrawal-address';
import {
  getOrCreatePlayerAccount,
  ensureJackpotAccounts,
  ensureRakeAccount,
  getRakeAccountId,
  ensureInsuranceAccounts,
  insuranceAccountId,
  reinsuranceAccountId,
} from '../wallet/system-accounts';
import {
  clawbackTransferable,
  backstopAmount,
  assertMultiSig,
  type ReinsuranceScope,
} from '../reinsurance/reinsurance-rules';
import { getInsuranceReserve } from '../wallet/insurance-reserve';
import { getOpsOverview } from '../ops/overview';
import { getAdminPlayerDetail, getPlayerBalances } from '../ops/player-detail';
import { getSecurityEvents, recordSettlementFailure } from '../ops/security-events';
import { getWithdrawalQueue } from '../ops/withdrawal-queue';
import { getLeagueOverview } from '../ops/league-overview';
import {
  requestTopUp,
  requestCashOut,
  approveLeagueFunding,
  rejectLeagueFunding,
  executeLeagueFunding,
  pendingLeagueFunding,
} from '../league/league-funding';
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
  putLeagueSettings,
  leaguesWithDueRakeChange,
  membershipOf,
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

/** The four jackpot tiers, as they appear inside a pool id. */
const JACKPOT_TIERS = new Set(['mini', 'minor', 'major', 'grand']);

/**
 * Which table a jackpot pool belongs to, read out of the pool id.
 *
 * The game server names its pools `jp:<tier>:<table>` (see `tableJackpotAccounts`). This used to
 * take `split(':')[1]`, which is the TIER, so every table's pools were created owned by "mini".
 * Two consequences, both bad:
 *
 *   - the pools were not per-table at all — every table shared one owner; and
 *   - `accounts` is uniquely indexed on (accountType, ownerId, scope), so the SECOND table ever to
 *     settle tried to insert a different `_id` under the same key, hit a duplicate-key error, and
 *     took the whole settlement down with it. The room was left stuck mid-hand, forever.
 *
 * Tolerates either ordering by picking the segment that is not a tier name, so a pool id written
 * the other way round (`jp:<table>:<tier>`, as the old comment here claimed) still resolves. An id
 * of an unrecognised shape falls back to the round id, which is at least traceable.
 */
export function jackpotPoolOwner(poolId: string, fallback: string): string {
  const [prefix, ...rest] = poolId.split(':');
  if (prefix !== 'jp' || rest.length === 0) return fallback;
  return rest.find((part) => part.length > 0 && !JACKPOT_TIERS.has(part)) ?? fallback;
}

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

  // The player's registered withdrawal address + when it becomes withdrawable (48h after a change).
  r.get(
    '/me/withdrawal-address',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const rec = await getWithdrawalAddress(req.dataScope!.playerId);
      if (!rec) {
        res.json({ configured: false });
        return;
      }
      res.json({ configured: true, address: rec.address, updatedAt: rec.updatedAt, withdrawableAt: withdrawableAt(rec) });
    }),
  );
  const setAddressBody = z.object({ address: z.string().min(1) });
  r.post(
    '/me/withdrawal-address',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { address } = setAddressBody.parse(req.body);
      if (!isValidTronAddress(address)) throw new ApiError(400, 'invalid TRON address');
      const rec = await setWithdrawalAddress(req.dataScope!.playerId, address);
      res.json({ address: rec.address, updatedAt: rec.updatedAt, withdrawableAt: withdrawableAt(rec) });
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
      // §3.6: withdrawals go only to the registered address, and only 48h after it was changed.
      try {
        await assertWithdrawableAddress(req.dataScope!.playerId, address);
      } catch (e) {
        if (e instanceof WithdrawalAddressError) throw new ApiError(403, e.message);
        throw e;
      }
      const acc = await getOrCreatePlayerAccount(req.dataScope!.playerId);

      // Automated withdrawal brakes (§CB4/CB5). These look ONLY at withdrawal-count anomalies —
      // never reputation or anti-bot (iron rule #3) — and they fail the request temporarily, they do
      // not touch the account's funds. CB4: this account is withdrawing abnormally often; CB5: the
      // whole platform's withdrawal rate has spiked. A trip also logs + alerts ops via the breaker.
      const cb4 = await evaluateCB4(acc._id, Number(process.env.WITHDRAWAL_CB4_LIMIT ?? 5));
      if (cb4.tripped) throw new ApiError(429, 'too many withdrawals from this account — please try again later');
      const cb5 = await evaluateCB5(Number(process.env.WITHDRAWAL_CB5_THRESHOLD ?? 100));
      if (cb5.tripped) throw new ApiError(503, 'withdrawals are briefly throttled — please try again shortly');

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
      const rakeDest = getRakeDestination(b.tableType, b.leagueId);
      await ensureRakeAccount(rakeDest.accountType, rakeDest.ownerId);
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
      const tableOwner = jackpotPoolOwner(b.jackpotAccounts.mini, b.roundId);
      await ensureJackpotAccounts(tableOwner, b.jackpotAccounts);
      // The rake destination (TREASURY / LEAGUE_INVENTORY) must exist before settlement credits it —
      // on a fresh DB it does not, so ensure it here (like the jackpot pools above).
      const rakeDest = getRakeDestination(b.tableType, b.leagueId);
      await ensureRakeAccount(rakeDest.accountType, rakeDest.ownerId);
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

  // Insurance premium (PLAYER → INSURANCE) and payout (INSURANCE → PLAYER). The pool is owned by
  // PLATFORM or a leagueId — dual-wallet isolation means a league's premiums fund only its own pool
  // (the player account is resolved in the owner's scope). Idempotent per (businessId, player). These
  // close the "INSURANCE_PREMIUM/PAYOUT defined but never moved" gap; they stay dormant until the
  // game's underwriting calls them (insurance is not surfaced in the client yet).
  const insuranceBody = z.object({
    playerId: z.string().min(1),
    amount: money,
    ownerId: z.string().min(1).default(PLATFORM_SCOPE),
    businessId: z.string().min(1),
  });
  r.post(
    '/internal/insurance/premium',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = insuranceBody.parse(req.body);
      await ensureInsuranceAccounts(b.ownerId);
      const player = await getOrCreatePlayerAccount(b.playerId, b.ownerId);
      const result = await transfer({
        fromAccountId: player._id,
        toAccountId: insuranceAccountId(b.ownerId),
        amount: Money.fromDecimalString(b.amount),
        type: LedgerType.INSURANCE_PREMIUM,
        businessId: b.businessId,
        idempotencyKey: `${b.businessId}:ins-premium:${b.playerId}`,
      });
      res.json({ applied: result.applied });
    }),
  );
  r.post(
    '/internal/insurance/payouts',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = insuranceBody.parse(req.body);
      await ensureInsuranceAccounts(b.ownerId);
      const player = await getOrCreatePlayerAccount(b.playerId, b.ownerId);
      const result = await transfer({
        fromAccountId: insuranceAccountId(b.ownerId),
        toAccountId: player._id,
        amount: Money.fromDecimalString(b.amount),
        type: LedgerType.INSURANCE_PAYOUT,
        businessId: b.businessId,
        idempotencyKey: `${b.businessId}:ins-payout:${b.playerId}`,
      });
      res.json({ applied: result.applied });
    }),
  );

  // Agent commission (TREASURY → agent's player account). An agent earns a cut of the platform rake
  // its referred players generate; this actually MOVES that money (the agent store only recorded it
  // before). Idempotent per (businessId, agent). Dormant until the agent engine calls it per hand.
  const agentCommissionBody = z.object({
    agentPlayerId: accountId,
    amount: money,
    businessId: z.string().min(1),
  });
  r.post(
    '/internal/agent-commission',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = agentCommissionBody.parse(req.body);
      const dest = getRakeDestination(TableType.PLATFORM, undefined); // commission is a cut of platform rake
      const treasuryId = await getRakeAccountId(dest.accountType, dest.ownerId);
      const agent = await getOrCreatePlayerAccount(b.agentPlayerId, PLATFORM_SCOPE);
      const result = await transfer({
        fromAccountId: treasuryId,
        toAccountId: agent._id,
        amount: Money.fromDecimalString(b.amount),
        type: LedgerType.AGENT_COMMISSION,
        businessId: b.businessId,
        idempotencyKey: `${b.businessId}:agent-commission:${b.agentPlayerId}`,
      });
      res.json({ applied: result.applied });
    }),
  );

  // ── Reinsurance (the backstop behind insurance) ──────────────────────────
  // Wires the reinsurance rules (pure functions with no callers until now) to real transfers. Scope-
  // isolated by construction: a league's reinsurance never funds the platform's and vice-versa.
  // Dormant until the insurance/ops engine calls them.
  const reinScope = (ownerId: string): ReinsuranceScope =>
    ownerId === PLATFORM_SCOPE ? { kind: 'PLATFORM' } : { kind: 'LEAGUE', leagueId: ownerId };

  // Clawback: sweep a capped share of the insurance pool's monthly net profit into reinsurance
  // (INSURANCE → REINSURANCE). Capped so the backstop stays a buffer, not a hoard.
  const clawbackBody = z.object({
    ownerId: z.string().min(1).default(PLATFORM_SCOPE),
    monthlyNetProfit: money,
    historicalMaxSingleDayPayout: money,
    businessId: z.string().min(1),
  });
  r.post(
    '/internal/reinsurance/clawback',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = clawbackBody.parse(req.body);
      const reserve = await getInsuranceReserve(b.ownerId);
      const amount = clawbackTransferable(
        Money.fromDecimalString(b.monthlyNetProfit),
        Money.fromDecimalString(reserve.reinsuranceBalance),
        Money.fromDecimalString(b.historicalMaxSingleDayPayout),
      );
      if (!amount.isPositive()) {
        res.json({ applied: false, amount: '0' });
        return;
      }
      const result = await transfer({
        fromAccountId: insuranceAccountId(b.ownerId),
        toAccountId: reinsuranceAccountId(b.ownerId),
        amount,
        type: LedgerType.REINSURANCE_INJECT,
        businessId: b.businessId,
        idempotencyKey: `${b.businessId}:reins-clawback`,
      });
      res.json({ applied: result.applied, amount: amount.toString() });
    }),
  );

  // Backstop: reinsurance tops insurance up for a shortfall it can't cover (REINSURANCE → INSURANCE),
  // never beyond what reinsurance holds, never across scopes.
  const backstopBody = z.object({
    ownerId: z.string().min(1).default(PLATFORM_SCOPE),
    shortfall: money,
    businessId: z.string().min(1),
  });
  r.post(
    '/internal/reinsurance/backstop',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = backstopBody.parse(req.body);
      const reserve = await getInsuranceReserve(b.ownerId);
      const scope = reinScope(b.ownerId);
      const amount = backstopAmount(
        Money.fromDecimalString(b.shortfall),
        Money.fromDecimalString(reserve.reinsuranceBalance),
        scope,
        scope,
      );
      if (!amount.isPositive()) {
        res.json({ applied: false, amount: '0' });
        return;
      }
      const result = await transfer({
        fromAccountId: reinsuranceAccountId(b.ownerId),
        toAccountId: insuranceAccountId(b.ownerId),
        amount,
        type: LedgerType.REINSURANCE_PAYOUT,
        businessId: b.businessId,
        idempotencyKey: `${b.businessId}:reins-backstop`,
      });
      res.json({ applied: result.applied, amount: amount.toString() });
    }),
  );

  // Company money into the backstop — the extreme lever, so MULTI-SIG (two DISTINCT approvers).
  // Deliberately TREASURY → REINSURANCE, not TREASURY → INSURANCE: the latter is off the ClearingRules
  // whitelist by design (§3.3), so the top-up flows through the backstop, which then covers insurance.
  const treasuryTopupBody = z.object({
    amount: money,
    approvals: z.array(z.object({ approverId: z.string().min(1), at: z.coerce.date() })).min(1),
    businessId: z.string().min(1),
  });
  r.post(
    '/internal/reinsurance/treasury-topup',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = treasuryTopupBody.parse(req.body);
      try {
        assertMultiSig(b.approvals);
      } catch (e) {
        throw new ApiError(403, e instanceof Error ? e.message : 'multi-sig approval required');
      }
      const dest = getRakeDestination(TableType.PLATFORM, undefined);
      const treasuryId = await getRakeAccountId(dest.accountType, dest.ownerId);
      await ensureInsuranceAccounts(PLATFORM_SCOPE);
      const result = await transfer({
        fromAccountId: treasuryId,
        toAccountId: reinsuranceAccountId(PLATFORM_SCOPE),
        amount: Money.fromDecimalString(b.amount),
        type: LedgerType.REINSURANCE_INJECT,
        businessId: b.businessId,
        idempotencyKey: `${b.businessId}:treasury-topup`,
      });
      res.json({ applied: result.applied });
    }),
  );

  // ── Withdrawal lifecycle (internal / ops) ────────────────────────────────
  async function currentState(id: string): Promise<string> {
    const w = await WithdrawalModel.findById(id);
    if (!w) throw new ApiError(404, `withdrawal not found: ${id}`);
    return w.state;
  }

  /**
   * The admin Overview's facts (SAMUEL.md task 3, screen 1).
   *
   * `internalAuth`, not a player token: this is platform-wide money, and the
   * only caller is the gateway, which checks the administrator's role before
   * asking. financial-core has no notion of who is an admin — that role lives
   * with identity in the gateway — so the boundary here is "internal caller",
   * and the boundary there is "is this person ops".
   */
  r.get(
    '/internal/ops/overview',
    internalAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(await getOpsOverview());
    }),
  );

  /**
   * One player's account detail, for the admin Players screen.
   *
   * GET only, and there is deliberately no sibling that writes. "No balance
   * editing from the UI — ever" is held by having nothing here that could:
   * moving a player's money goes through the withdrawal and settlement paths,
   * which are audited, idempotent and double-entry. A direct edit is none of
   * those.
   */
  r.get(
    '/internal/players/:playerId',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await getAdminPlayerDetail(String(req.params.playerId)));
    }),
  );

  /**
   * Recent security-log entries for the admin Alerts screen.
   *
   * Append-only and read-only: there is no route that edits or deletes one,
   * which is the point of keeping an audit trail. An admin can acknowledge an
   * alert in their own head; they cannot make it stop having happened.
   */
  const alertsQuery = z.object({ limit: z.coerce.number().int().positive().max(500).optional() });
  r.get(
    '/internal/ops/alerts',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { limit } = alertsQuery.parse(req.query);
      res.json({ events: await getSecurityEvents(limit) });
    }),
  );

  /**
   * Every league with its inventory, rake and insurance (admin screen 4).
   *
   * Read-only. Top-up and cash-out move money between TREASURY and
   * LEAGUE_INVENTORY; the clearing rules permit both and the ledger types
   * exist, but nothing performs either yet. That is a separate money path.
   */
  r.get(
    '/internal/ops/leagues',
    internalAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ leagues: await getLeagueOverview() });
    }),
  );

  /**
   * League settings FACTS — read and write (§2 self-service).
   *
   * No band check and no transition logic here: the platform min/max and the
   * 7-day rake transition are RULES, applied in game-server before it calls
   * this. Two copies of a rake band would eventually give two answers.
   */
  const leagueSettingsBody = z.object({
    settings: z.object({
      rakeBps: z.number().int().nonnegative().max(10_000),
      tableHours: z.number().int().positive().max(24),
      buyIn: z.number().int().nonnegative(),
      spectatorsAllowed: z.boolean(),
    }),
    pendingRakeChange: z
      .object({
        rakeBps: z.number().int().nonnegative().max(10_000),
        /** Epoch ms. Set by the platform; this only stores it. */
        effectiveAt: z.number().int().positive(),
      })
      .nullable(),
  });
  r.put(
    '/internal/leagues/:leagueId/settings',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const body = leagueSettingsBody.parse(req.body);
      res.json(
        await putLeagueSettings(
          String(req.params.leagueId),
          body.settings,
          body.pendingRakeChange
            ? {
                rakeBps: body.pendingRakeChange.rakeBps,
                effectiveAt: new Date(body.pendingRakeChange.effectiveAt),
              }
            : null,
        ),
      );
    }),
  );
  /**
   * One player's role in one league, or null.
   *
   * The gateway needs this to decide whether a caller may open a league room,
   * and it must come from here rather than the request: a caller claiming to
   * administer someone else's league is the attack that endpoint exists to
   * refuse. Null rather than 404 for a non-member — "not a member" is a normal
   * answer, and the gateway turns it into the 404 a stranger should see.
   */
  r.get(
    '/internal/leagues/:leagueId/members/:playerId',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        role: await membershipOf(String(req.params.leagueId), String(req.params.playerId)),
      });
    }),
  );

  r.get(
    '/internal/leagues/due-rake-changes',
    internalAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      const due = await leaguesWithDueRakeChange(new Date());
      res.json({
        leagues: due.map((d) => ({
          ...d,
          pendingRakeChange: {
            rakeBps: d.pendingRakeChange.rakeBps,
            effectiveAt: d.pendingRakeChange.effectiveAt.toISOString(),
          },
        })),
      });
    }),
  );

  /**
   * League funding — request, review, execute (12-week plan, W10).
   *
   * Three endpoints because it is three decisions, and they are deliberately
   * not collapsible: ops confirming a TRC-20 receipt is a judgment about the
   * outside world, and it must be possible to reverse it before the ledger
   * moves. See src/league/league-funding.ts.
   *
   * Every actor is named in the body. internalAuth proves the gateway is
   * calling; it says nothing about WHICH administrator, and that is the entire
   * content of an approval.
   */
  r.get(
    '/internal/league-funding',
    internalAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ requests: await pendingLeagueFunding() });
    }),
  );

  const topUpBody = z.object({
    leagueId: z.string().min(1),
    amount: money,
    requestedBy: z.string().min(1),
  });
  r.post(
    '/internal/league-funding/top-ups',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = topUpBody.parse(req.body);
      const id = await requestTopUp({
        leagueId: b.leagueId,
        amount: Money.fromDecimalString(b.amount),
        requestedBy: b.requestedBy,
      });
      res.status(201).json({ requestId: id });
    }),
  );

  const cashOutBody = topUpBody.extend({ address: z.string().min(1) });
  r.post(
    '/internal/league-funding/cash-outs',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = cashOutBody.parse(req.body);
      const id = await requestCashOut({
        leagueId: b.leagueId,
        amount: Money.fromDecimalString(b.amount),
        requestedBy: b.requestedBy,
        address: b.address,
      });
      res.status(201).json({ requestId: id });
    }),
  );

  const approverBody = z.object({ approvedBy: z.string().min(1) });
  r.post(
    '/internal/league-funding/:id/approve',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { approvedBy } = approverBody.parse(req.body);
      res.json(await approveLeagueFunding(String(req.params.id), approvedBy));
    }),
  );

  const rejectBody = z.object({ rejectedBy: z.string().min(1), reason: z.string().min(1).max(200) });
  r.post(
    '/internal/league-funding/:id/reject',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = rejectBody.parse(req.body);
      await rejectLeagueFunding(String(req.params.id), b.rejectedBy, b.reason);
      res.json({ ok: true });
    }),
  );

  /** The only one that moves money. Separate from approval on purpose. */
  const executeBody = z.object({ executedBy: z.string().min(1) });
  r.post(
    '/internal/league-funding/:id/execute',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { executedBy } = executeBody.parse(req.body);
      const treasury = await AccountModel.findOne({ accountType: 'TREASURY' }).lean();
      if (!treasury) throw new ApiError(409, 'no treasury account');
      res.json(await executeLeagueFunding(String(req.params.id), treasury._id, executedBy));
    }),
  );

  /** The withdrawal review queue (admin screen 2). */
  r.get(
    '/internal/ops/withdrawals',
    internalAuth,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ withdrawals: await getWithdrawalQueue() });
    }),
  );

  /**
   * Refuse a withdrawal and release any hold.
   *
   * rollbackWithdrawal already existed with no route — the state machine could
   * refuse one, nothing could ask it to. From REQUESTED there is nothing held
   * to release; from APPROVED the clearing hold returns to spendable, which is
   * the part a player notices.
   */
  const rejectWithdrawalBody = z.object({
    rejectedBy: z.string().min(1),
    reason: z.string().min(1).max(200),
  });
  r.post(
    '/internal/withdrawals/:id/reject',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const b = rejectWithdrawalBody.parse(req.body);
      // The refusing administrator is recorded in the reason, since the
      // withdrawal document has no rejectedBy field of its own.
      await rollbackWithdrawal(String(req.params.id), `${b.reason} (refused by ${b.rejectedBy})`);
      res.json({ state: await currentState(String(req.params.id)) });
    }),
  );

  /** Balances for a set of players, for the admin search results list. */
  const balancesBody = z.object({ playerIds: z.array(z.string().min(1)).max(100) });
  r.post(
    '/internal/players/balances',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { playerIds } = balancesBody.parse(req.body);
      const balances = await getPlayerBalances(playerIds);
      res.json({ balances: Object.fromEntries(balances) });
    }),
  );

  /**
   * Approve a withdrawal, as a named person (§3.6).
   *
   * `approverId` is required. `internalAuth` proves the caller is the gateway,
   * not WHICH administrator is behind it — and which administrator is the whole
   * content of a second signature. The gateway takes it from the admin's own
   * token and passes it here; it is never read from a client-supplied body.
   */
  const approveBody = z.object({ approverId: z.string().min(1) });
  r.post(
    '/internal/withdrawals/:id/approve',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { approverId } = approveBody.parse(req.body);
      // Returns { state, approvals, required }: a large withdrawal stays REQUESTED with e.g. 1/2 until
      // a second, DISTINCT approver signs off. Funds are only held on the final approval.
      res.json(await approveWithdrawal(req.params.id as string, approverId));
    }),
  );
  // Take an APPROVED withdrawal on-chain: sign + broadcast the USDT transfer from the hot wallet and
  // record the real txHash. On any failure the withdrawal rolls back (clearing hold released), so a
  // failed send never strands the player's money. Needs TRON_HOT_WALLET_KEY (else 500 with a clear
  // message, and the withdrawal stays APPROVED for a retry once the key is set).
  r.post(
    '/internal/withdrawals/:id/sign-broadcast',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const txHash = await signAndBroadcastWithdrawal(req.params.id as string);
      res.json({ state: await currentState(req.params.id as string), txHash });
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

  // ── CB3 report (internal) ────────────────────────────────────────────────
  // The jackpot anomaly detector lives in the game-server's JackpotEngine (it counts a table's
  // triggers and freezes the pool locally the moment three land inside an hour). This is the FC side
  // of that breaker: the engine reports the freeze here so it is recorded in the append-only
  // security_log and paged to ops — closing the gap where a table would silently freeze with nobody
  // alerted. Idempotent by nature: re-reporting the same anomaly just writes another log line.
  const cb3Body = z.object({ tableId: z.string().min(1), triggersLastHour: z.number().int().min(0) });
  r.post(
    '/internal/circuit-breakers/cb3',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { tableId, triggersLastHour } = cb3Body.parse(req.body);
      const event = await evaluateCB3(tableId, triggersLastHour);
      res.json(event);
    }),
  );

  // ── Settlement-failure report (internal) ─────────────────────────────────
  // The game-server returns a table to WAITING when a hand fails to settle (nothing paid or reversed
  // — settleTableHand is atomic). It reports the failure here so a recurring ledger fault lands in the
  // append-only security_log and pages ops, instead of staying a console line on the game node.
  const settlementFailureBody = z.object({
    tableId: z.string().min(1),
    reason: z.string().min(1).max(500),
    roundId: z.string().min(1).optional(),
  });
  r.post(
    '/internal/settlement-failure',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { tableId, reason, roundId } = settlementFailureBody.parse(req.body);
      await recordSettlementFailure(tableId, reason, roundId);
      res.json({ recorded: true });
    }),
  );

  return r;
}
