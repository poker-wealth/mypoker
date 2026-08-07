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
import { WithdrawalModel } from '../withdrawal/withdrawal.model';
import { asyncHandler, internalAuth, dataScopeMiddleware, ApiError } from './middleware';
import { openApiSpec } from './openapi';
import { buildAuthRouter } from '../auth/auth.routes';

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

  // ── Internal Auth endpoints (shared secret) ───────────────────────────────
  r.use('/internal/auth', internalAuth, buildAuthRouter());

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
