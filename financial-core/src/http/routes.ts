import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Money } from '../domain/money';
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
import { getOrCreatePlayerAccount } from '../wallet/system-accounts';
import { getPlayerStats, getPlayerHistory } from '../stats/player-stats';
import { getSettings, updateSettings } from '../settings/player-settings';
import { getReputation, ReputationDeductionModel } from '../reputation/player-reputation';
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
  agentEligibility,
} from '../agent/agent-store';
import {
  notify,
  listNotifications,
  markRead,
} from '../notifications/notification-store';
import { getVipStanding, recordVolume } from '../vip/volume-tracker';
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
      res.json({
        playerId,
        available: Money.fromDecimal128(acc.availableBalance).toString(),
        locked: Money.fromDecimal128(acc.lockedBalance).toString(),
        clearing: Money.fromDecimal128(acc.clearingBalance).toString(),
      });
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

  // Reputation. Read-only to players, and deliberately NOT money: nothing here
  // is reachable from the withdrawal path, and the spec calls a reputation score
  // affecting a withdrawal a critical failure.
  r.get(
    '/me/reputation',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await getReputation(req.dataScope!.playerId));
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

  r.get(
    '/me/agent/eligibility',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const playerId = req.dataScope!.playerId;
      const reputation = await getReputation(playerId);
      // Collusion is already a reputation deduction reason, so the finding is
      // read from there rather than kept in a second place that could disagree.
      const deductions = await ReputationDeductionModel.find({ playerId }).lean();
      res.json(
        await agentEligibility(playerId, reputation, {
          hasConfirmedCollusion: deductions.some((d) => d.reason === 'COLLUSION_CONFIRMED'),
          antiBotHighRisk: deductions.some((d) => d.reason === 'BOT_CONFIRMED'),
        }),
      );
    }),
  );

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
  const notifyBody = z.object({
    playerId: z.string().min(1),
    kind: z.enum(['RESULT', 'DEPOSIT', 'PROMO', 'JACKPOT', 'SYSTEM']),
    titleKey: z.string().min(1),
    eventId: z.string().min(1),
    params: z.record(z.union([z.string(), z.number()])).optional(),
  });
  r.post(
    '/internal/notifications',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const body = notifyBody.parse(req.body);
      const stored = await notify({
        playerId: body.playerId,
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
  r.get(
    '/me/vip',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await getVipStanding(req.dataScope!.playerId));
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

  const withdrawalBody = z.object({ amount: money, address: z.string().min(1) });
  r.post(
    '/me/withdrawals',
    dataScopeMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { amount, address } = withdrawalBody.parse(req.body);
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
      const receipt = await settleRound({
        roundId: b.roundId,
        tableType: b.tableType,
        ...(b.leagueId ? { leagueId: b.leagueId } : {}),
        winnerAccountId: b.winnerAccountId,
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
      const m = (s: string): Money => Money.fromDecimalString(s);
      const result = await settleTableHand({
        roundId: b.roundId,
        tableType: b.tableType,
        ...(b.leagueId ? { leagueId: b.leagueId } : {}),
        losers: b.losers.map((l) => ({ accountId: l.playerAccountId, amount: m(l.amount) })),
        winners: b.winners.map((w) => ({ accountId: w.playerAccountId, amount: m(w.amount) })),
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

  const seatBody = z.object({ playerAccountId: accountId, amount: money });
  r.post(
    '/internal/buy-ins',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { playerAccountId, amount } = seatBody.parse(req.body);
      await lockForBuyIn(playerAccountId, Money.fromDecimalString(amount));
      res.json({ ok: true });
    }),
  );
  r.post(
    '/internal/releases',
    internalAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const { playerAccountId, amount } = seatBody.parse(req.body);
      await releaseToAvailable(playerAccountId, Money.fromDecimalString(amount));
      res.json({ ok: true });
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
