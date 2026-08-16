import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { verifyToken, TokenError, type TokenClaims } from './jwt';
import {
  IllegalFundFlowError,
  InsufficientBalanceError,
  AccountNotFoundError,
  WithdrawalNotFoundError,
  InvalidWithdrawalTransitionError,
} from '../wallet/errors';
import { alertOps } from '../lib/alert';
import { LeagueError } from '../league/league-store';
import { LeagueFundingError } from '../league/league-funding';
import { AgentError } from '../agent/agent-store';

// Attach the verified scope to the request (leagueId comes ONLY from here, never the body).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      dataScope?: TokenClaims;
    }
  }
}

/** An error carrying an explicit HTTP status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Wrap an async route handler so thrown/rejected errors reach the error middleware. */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Service-to-service auth for /internal endpoints. The game server presents the shared secret in
 * `x-internal-secret`. Compared timing-safe.
 */
export function internalAuth(req: Request, _res: Response, next: NextFunction): void {
  const provided = req.header('x-internal-secret') ?? '';
  const expected = process.env.INTERNAL_API_SECRET ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (expected.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(401, 'invalid internal credentials');
  }
  next();
}

/**
 * dataScopeMiddleware (FairPlay §11 / spec): verify the Bearer JWT and inject the scope. leagueId
 * is taken from the token claims ONLY — request bodies can never widen a caller's data scope.
 */
export function dataScopeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.header('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(auth);
  if (!match) throw new ApiError(401, 'missing bearer token');
  const secret = process.env.JWT_SECRET ?? '';
  if (!secret) throw new ApiError(500, 'JWT secret not configured');
  try {
    req.dataScope = verifyToken(match[1] as string, secret);
  } catch (err) {
    if (err instanceof TokenError) throw new ApiError(401, err.message);
    throw err;
  }
  next();
}

/** Map domain + validation errors to HTTP status codes. Last middleware in the chain. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'validation_failed', details: err.issues });
    return;
  }
  // A league rule refusal is the caller's problem, not the server's — 'already
  // exists', 'invite-only', 'not a member'. Without this it surfaces as a 500,
  // which reads as an outage and invites a retry that can never succeed.
  if (err instanceof AgentError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof LeagueError) {
    res.status(409).json({ error: err.message });
    return;
  }
  // Same reasoning, and it was missed: every league-funding refusal — the 24h
  // cash-out cooldown, "request is not awaiting approval", "request is
  // REJECTED, not approvable" — was falling through to the 500 below. Two
  // things were wrong with that. The caller got `internal_error` instead of the
  // reason, so an admin who hit the cooldown could not be told to come back in
  // six hours; and every ordinary refusal fired an ops alert, which is how a
  // pager gets ignored.
  if (err instanceof LeagueFundingError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof RangeError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof IllegalFundFlowError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof AccountNotFoundError || err instanceof WithdrawalNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (
    err instanceof InsufficientBalanceError ||
    err instanceof InvalidWithdrawalTransitionError
  ) {
    res.status(409).json({ error: err.message });
    return;
  }
  // Unknown — don't leak internals; alert ops.
  const message = err instanceof Error ? err.message : 'internal error';
  void alertOps('Unhandled API error', { message });
  res.status(500).json({ error: 'internal_error' });
}
