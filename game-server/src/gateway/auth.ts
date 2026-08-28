import { Router, type NextFunction, type Request, type Response } from 'express';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import type { GatewayConfig } from './config';
import { userStore } from '../auth/user-store';
import { otpStore, type OtpStore } from '../auth/otp-store';
import { defaultSuspensionGate, type SuspensionGate } from '../auth/suspension-gate';
import { OTP_TTL_MS } from '../auth/otp-rules';
import {
  validateSignupCredentials,
  validateDisplayName,
  validatePasswordStrength,
} from '../auth/credential-rules';
import {
  financialCoreOtpMailer,
  resolveDeliveryFailure,
  type OtpMailer,
} from './mailer';
import { signToken, verifyToken, TokenError } from './tokens';
import {
  verifyInitData,
  playerIdForTelegramUser,
  displayNameFor,
  type TelegramUser,
} from './telegram';

/**
 * Player authentication.
 *
 * The Mini App sends its signed `initData`; we verify it, derive a stable player
 * id from the Telegram user id, and hand back a JWT the Financial Core already
 * knows how to verify. No player rows are written anywhere — financial-core
 * creates the account lazily the first time money is touched.
 */

/** The signed-in player, as the client sees it. */
export interface PlayerProfile {
  playerId: string;
  displayName: string;
  username: string | null;
  photoUrl: string | null;
  telegramId: number | null;
  vipTier: number;
  /** 'ops' for a platform administrator; 'player' for everyone else. */
  role: 'player' | 'ops';
}

/**
 * What a player is told about their OWN account, at `/auth/me` only.
 *
 * `email` and `hasPassword` are deliberately absent from `PlayerProfile`
 * itself: that shape is also what `/login`, `/signup` (via `/verify-otp`),
 * `/google` and `/change-display-name` return, and none of those need either
 * field to do their job. Widening the shared shape would mean every one of
 * those call sites starts carrying a `hasPassword` boolean and an email
 * address nobody there asked for -- more blast radius than "a self-lookup can
 * see its own email" requires. `/auth/me` builds its own response object
 * rather than going through `asProfile()`, so extending it here costs nothing
 * elsewhere.
 *
 * `email` is `null` for a Telegram player, who has no stored document at all
 * (see the handler below) -- never a fabricated address. `hasPassword` is
 * `false` in that same case, and for any Google-linked account with no
 * `passwordHash`. Neither field is ever the hash itself.
 */
export interface SelfProfile extends PlayerProfile {
  email: string | null;
  hasPassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`; absent on unauthenticated routes. */
      player?: { playerId: string; role: string };
    }
  }
}

function profileFromTelegram(user: TelegramUser): PlayerProfile {
  return {
    playerId: playerIdForTelegramUser(user.id),
    displayName: displayNameFor(user),
    username: user.username ?? null,
    photoUrl: user.photo_url ?? null,
    telegramId: user.id,
    vipTier: 0,
    // Telegram sign-in never grants ops — admin authority comes only through the
    // email/password path (a Telegram player can never become an administrator).
    role: 'player',
  };
}

/**
 * Rejects any request without a valid, unexpired player token — and any request
 * from an account that has since been SUSPENDED.
 *
 * The suspension check is what makes a ban take effect on a session that
 * already exists. Without it, suspension only closed the door to signing in
 * again: a player already holding a token kept playing until it expired, up to
 * twenty-four hours, which is precisely the window that matters for the reason
 * suspensions get issued. See `auth/suspension-gate.ts` for why it is cached
 * and why it fails open.
 *
 * 401 with a `code`, not 403: the client's 401 handler already drops the
 * session and returns the player to sign-in, which is exactly the right
 * outcome, and the code lets the screen say why rather than "Signed out".
 */
export function requireAuth(config: GatewayConfig, gate: SuspensionGate = defaultSuspensionGate) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing bearer token' });
      return;
    }
    try {
      const claims = verifyToken(header.slice('Bearer '.length), config.jwtSecret);
      req.player = { playerId: claims.playerId, role: claims.role ?? 'player' };
      gate
        .isSuspended(claims.playerId)
        .then((suspended) => {
          if (suspended) {
            res.status(401).json({
              error: 'This account is suspended. Contact support.',
              code: 'account_suspended',
            });
            return;
          }
          next();
        })
        .catch(() => {
          // The gate already swallows lookup failures; this is the belt to that
          // brace. An unexpected throw here must not 500 every request.
          next();
        });
      return;
    } catch (e) {
      const reason = e instanceof TokenError ? e.message : 'invalid token';
      res.status(401).json({ error: reason });
    }
  };
}

/**
 * Rejects anyone who is not a platform administrator.
 *
 * The `ops` role has been carried in the token type since the gateway was
 * written and enforced by nothing — `requireAuth` reads it onto `req.player`
 * and no route has ever looked at it. This is the first check, so it is worth
 * being exact about what it does and does not mean.
 *
 * Stack it AFTER `requireAuth`, never instead of it: this reads the role that
 * middleware put there, so on its own it would authorise an unauthenticated
 * request whose `req.player` is undefined. Ordering is the whole guard.
 *
 * 404, not 403, on the role check — BOTH role checks below. A 403 confirms
 * the admin API exists and that this account simply lacks the rank — which
 * tells someone probing with a stolen player token exactly what to go after
 * next. A missing token still gets 401 from `requireAuth`, because that is a
 * statement about the request rather than about what lies behind it.
 *
 * `league_admin` is deliberately NOT accepted. The spec gives league
 * administrators their OWN panel, scoped to their alliance — "league overview
 * (volume, rake, player list, Jackpot balances)… player risk scores visible to
 * league admin (for their own league players only)" (12-week plan, W10). The
 * platform's withdrawal queue, player list and treasury are a different scope,
 * and that panel is a separate build, not this one with a wider role check.
 *
 * A SECOND check runs after the token's own claim: `gate.isOps` confirms the
 * claim against the STORED role. Without it, demoting an administrator
 * (`PATCH /admin/players/:id`) writes the database and does nothing to a
 * session that already has a token — they keep full admin access until it
 * expires, up to `jwtTtlSeconds` (a day by default). This is exactly the gap
 * `SuspensionGate` closed for suspension, reusing the same cache/TTL/prime
 * machinery — see `auth/suspension-gate.ts`. A demoted account gets the
 * identical 404 a non-ops caller always got, never a 403: it must not be
 * distinguishable from "never was an admin" to whatever is holding that
 * token.
 */
export function requireAdmin(gate: SuspensionGate = defaultSuspensionGate) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.player?.role !== 'ops') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    // The token claimed ops when it was signed; confirm that against the
    // account's CURRENT role. `true` is the fallback if the lookup fails or
    // times out — see `SuspensionGate.isOps` for why that is not `false` and
    // not a hardcoded pass: it is "trust the claim already verified above",
    // which is what this check did with no verification at all before today.
    gate
      .isOps(req.player.playerId, true)
      .then((stillOps) => {
        if (!stillOps) {
          res.status(404).json({ error: 'not found' });
          return;
        }
        next();
      })
      .catch(() => {
        // `isOps` already swallows lookup failures internally; this is the
        // belt to that brace, same as `requireAuth`'s identical catch above.
        next();
      });
  };
}

/** Exactly the identity operations these routes perform. Nothing wider. */
export type AuthUserStore = Pick<
  typeof userStore,
  | 'startSignup'
  | 'verifyPassword'
  | 'markEmailVerified'
  | 'oauth'
  | 'updateDisplayName'
  | 'changePassword'
  | 'findForPasswordReset'
  | 'resetPassword'
>;

/**
 * Seams for testing the confirmation flow.
 *
 * All four default to the real thing, so nothing about production wiring
 * changes. They exist because the flow's interesting behaviour is about time
 * (expiry, cooldown) and about what leaves the process (the code, by email) —
 * neither of which can be observed by calling the routes and hoping.
 */
export interface AuthDeps {
  mailer?: OtpMailer;
  /** Injectable clock, so expiry and cooldown are testable without waiting. */
  now?: () => number;
  otps?: OtpStore;
  users?: AuthUserStore;
}

export function buildAuthRouter(config: GatewayConfig, deps: AuthDeps = {}): Router {
  const r = Router();
  const sendOtpMail =
    deps.mailer ??
    financialCoreOtpMailer({
      financialCoreUrl: config.financialCoreUrl,
      internalSecret: config.internalApiSecret,
    });
  const now = deps.now ?? ((): number => Date.now());
  const otps = deps.otps ?? otpStore;

  // Web identity (email/password + Google) — the browser sign-in path. The user
  // store lives HERE in the gateway (financial-core is money-only and just
  // verifies the JWT). This verifies the Google token / checks credentials, then
  // signs the same JWT every other login flavour gets.
  const authClient: AuthUserStore = deps.users ?? userStore;
  const googleClient = new OAuth2Client();

  // The token's role is the profile's role — so an admin who signs in with
  // email/password gets an `ops` token, and everyone else a `player` one. This
  // is the ONLY place `ops` enters a token, and only via the credential login
  // below (signup and Google always resolve to a player profile).
  const issue = (player: PlayerProfile): { token: string; player: PlayerProfile } => ({
    token: signToken(
      { playerId: player.playerId, role: player.role },
      config.jwtSecret,
      config.jwtTtlSeconds,
    ),
    player,
  });

  const asProfile = (u: {
    playerId: string;
    displayName?: string;
    email?: string;
    photoUrl?: string | null;
    role?: 'ops';
  }): PlayerProfile => ({
    playerId: u.playerId,
    displayName: u.displayName || u.email?.split('@')[0] || 'Player',
    username: u.email?.split('@')[0] ?? null,
    photoUrl: u.photoUrl ?? null,
    telegramId: null,
    vipTier: 0,
    role: u.role === 'ops' ? 'ops' : 'player',
  });

  // -- Email confirmation ---------------------------------------------------
  //
  // Sign-up is TWO STEPS. `/signup` writes an unconfirmed account and returns
  // NO TOKEN; only `/verify-otp`, given the code that was mailed, mints a
  // session. Nothing else changes about what a session is -- the same JWT, the
  // same claims -- so every route downstream is unaffected.
  //
  // The reason the token is withheld rather than a flag being set on a live
  // session: a flag has to be re-checked at every place that matters, and
  // docs/TRAPS.md #1 is a list of checks that were added and then not reached.
  // No token is a control that cannot be forgotten at a call site, because
  // there is no call site.

  const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

  const OTP_TTL_MINUTES = Math.round(OTP_TTL_MS / 60_000);

  /** What came of trying to get a code to somebody. */
  type MintOutcome =
    | { status: 'sent'; expiresAt: number; resendAvailableAt: number }
    | { status: 'rate_limited'; reason: 'cooldown' | 'too_many_sends'; retryAfterMs: number }
    | { status: 'undeliverable' };

  /**
   * Mint a code and mail it. Decides nothing about the HTTP response.
   *
   * Three callers need this and each answers differently: `/signup` turns a
   * failure into a refusal, `/resend-otp` into a 429, and `/login` into extra
   * fields on a 403 it was going to send anyway. Keeping the mechanics in one
   * place and the status codes at the call sites is what stops the rate limits
   * and the dev-console fallback being reimplemented three times.
   */
  const mintAndSend = async (email: string, playerId: string): Promise<MintOutcome> => {
    const at = now();
    const minted = await otps.issue(email, playerId, at);

    if (!minted.ok) {
      return { status: 'rate_limited', reason: minted.reason, retryAfterMs: minted.retryAfterMs };
    }

    const { code, expiresAt, resendAvailableAt, sends } = minted.issued;
    const delivery = await sendOtpMail({
      to: email,
      code,
      expiresInMinutes: OTP_TTL_MINUTES,
      // Unique per code, not per address: `expiresAt` moves on every issue and
      // `sends` distinguishes resends within one challenge. A constant key
      // would let the dedupe swallow every resend; a random one would defeat
      // the dedupe altogether.
      eventId: `otp:${email}:${expiresAt}:${sends}`,
    });

    if (delivery.outcome !== 'sent') {
      const resolved = resolveDeliveryFailure({
        outcome: delivery.outcome,
        ...(delivery.outcome === 'failed' ? { detail: delivery.detail } : {}),
        to: email,
        code,
        devAuthBypass: config.devAuthBypass,
      });
      if (!resolved.allow) {
        // Drop the challenge: it exists to track a code somebody received, and
        // nobody did. Left in place it would charge the resend cooldown to a
        // player who has nothing to type in, and answer their retry a minute
        // later with the same failure.
        await otps.discard(email);
        return { status: 'undeliverable' };
      }
    }

    return { status: 'sent', expiresAt, resendAvailableAt };
  };

  /**
   * The 200/429/503 answer for `/signup` and `/resend-otp`, from one outcome.
   *
   * `/login` deliberately does NOT use this — an unconfirmed sign-in is a 403
   * whatever became of the code, and turning it into a 429 or a 503 would tell
   * the client the login failed for a reason that has nothing to do with the
   * login.
   */
  const answerWithOutcome = (res: Response, email: string, outcome: MintOutcome): void => {
    if (outcome.status === 'rate_limited') {
      const seconds = Math.ceil(outcome.retryAfterMs / 1000);
      // Retry-After is in seconds and is what a well-behaved client actually
      // reads; the millisecond field is for our own UI countdown.
      res.set('Retry-After', String(seconds));
      res.status(429).json({
        error:
          outcome.reason === 'cooldown'
            ? `Please wait ${seconds}s before requesting another code.`
            : 'Too many codes have been requested for this address. Try again later.',
        code: outcome.reason,
        retryAfterMs: outcome.retryAfterMs,
      });
      return;
    }

    if (outcome.status === 'undeliverable') {
      // The unconfirmed ACCOUNT row stays, deliberately. It is reclaimable by
      // design -- a later signup for the same address overwrites it -- so
      // leaving it costs nothing and deleting it here would race a concurrent
      // attempt for the same address.
      res.status(503).json({
        error: 'We could not send the confirmation email. Please try again shortly.',
        code: 'email_undeliverable',
      });
      return;
    }

    res.json({
      pending: true,
      email,
      expiresAt: new Date(outcome.expiresAt).toISOString(),
      resendAvailableAt: new Date(outcome.resendAvailableAt).toISOString(),
    });
  };

  r.post('/signup', (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, string>;
      // `phone` is read only so that a phone sign-up gets the explicit refusal
      // below rather than a bare "email is required" that never mentions why
      // the field they filled in was ignored.
      const raw = body['email'] || body['identifier'] || body['phone'];
      const password = body['password'];
      const displayName = body['displayName'];

      if (!raw || !password) {
        res.status(400).json({ error: 'email and password are required' });
        return;
      }

      // Phone sign-up is refused HERE, before an account exists. It used to be
      // accepted, and with confirmation now mandatory it would create an
      // account that no code can ever reach: there is no SMS provider, so the
      // row would be permanently unconfirmable and permanently unsignable-in.
      // Better a clear refusal than an account that silently cannot be used.
      const email = normalizeEmail(raw);
      if (!email.includes('@')) {
        res.status(400).json({
          error: 'An email address is required - phone sign-up is not available.',
          code: 'email_required',
        });
        return;
      }

      // Everything else about the credentials, checked BEFORE a row is written.
      // The checklist line is "clear error, no account created", and the second
      // half of that is only true if this runs first: `startSignup` creates the
      // account, and the address is not validated again until financial-core
      // renders the mail, by which point the row exists and the caller gets an
      // unexplained 503 instead of "that is not a valid email address".
      const verdict = validateSignupCredentials(email, password);
      if (!verdict.ok) {
        res.status(400).json({ error: verdict.message, code: verdict.code });
        return;
      }

      let identity;
      try {
        identity = await authClient.startSignup(email, password, displayName);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'sign-up failed' });
        return;
      }

      answerWithOutcome(res, email, await mintAndSend(email, identity.playerId));
    })().catch((err: unknown) => {
      console.error('[auth] signup failed:', err);
      res.status(500).json({ error: 'internal error' });
    });
  });

  /**
   * Exchange a correct code for a session.
   *
   * The playerId comes from the CHALLENGE, never from the request. A client
   * that sends someone else's email with a code it somehow holds confirms that
   * address's account and no other -- there is no field it can supply that
   * redirects the result.
   */
  r.post('/verify-otp', (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, string>;
      const raw = body['email'] || body['identifier'];
      const code = body['code'];

      if (!raw || !code) {
        res.status(400).json({ error: 'email and code are required' });
        return;
      }
      const email = normalizeEmail(raw);

      const result = await otps.verify(email, code, now());
      if (!result.ok) {
        const status = result.reason === 'too_many_attempts' ? 429 : 400;
        const message: Record<typeof result.reason, string> = {
          no_challenge: 'No confirmation is pending for this address. Sign up again.',
          expired: 'That code has expired. Request a new one.',
          too_many_attempts: 'Too many incorrect codes. Request a new one.',
          incorrect: 'That code is not correct.',
        };
        res.status(status).json({ error: message[result.reason], code: result.reason });
        return;
      }

      const identity = await authClient.markEmailVerified(result.playerId);
      if (!identity) {
        // The challenge outlived the account it was for -- only reachable if
        // the row was deleted between signup and confirmation. Not an internal
        // error; there is simply nothing to sign in to.
        res
          .status(400)
          .json({ error: 'That account no longer exists. Sign up again.', code: 'no_account' });
        return;
      }

      res.json(issue(asProfile(identity)));
    })().catch((err: unknown) => {
      console.error('[auth] verify-otp failed:', err);
      res.status(500).json({ error: 'internal error' });
    });
  });

  /**
   * Another code for a confirmation already in flight.
   *
   * Requires a LIVE CHALLENGE and refuses otherwise, rather than looking the
   * address up and minting one. Minting on demand would turn this into a way to
   * send mail from our domain to any address anyone types, with no account
   * involved -- the rate limits would cap the volume but not the fact.
   */
  r.post('/resend-otp', (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, string>;
      const raw = body['email'] || body['identifier'];
      if (!raw) {
        res.status(400).json({ error: 'email is required' });
        return;
      }
      const email = normalizeEmail(raw);

      const pending = await otps.peek(email);
      if (!pending) {
        res.status(400).json({
          error: 'No confirmation is pending for this address. Sign up again.',
          code: 'no_challenge',
        });
        return;
      }

      answerWithOutcome(res, email, await mintAndSend(email, pending.playerId));
    })().catch((err: unknown) => {
      console.error('[auth] resend-otp failed:', err);
      res.status(500).json({ error: 'internal error' });
    });
  });

  r.post('/login', (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, string>;
      const raw = body['email'] || body['phone'] || body['identifier'];
      const password = body['password'];

      if (!raw || !password) {
        res.status(400).json({ error: 'email or phone number and password are required' });
        return;
      }
      // Phone sign-IN stays: accounts created before confirmation existed may
      // hold a phone number, and refusing them here would lock out people whose
      // account is perfectly valid. Only new phone sign-UPS are closed.
      const identifier = raw.includes('@') ? normalizeEmail(raw) : raw.trim();

      const check = await authClient.verifyPassword(identifier, password);

      if (check.ok) {
        res.json(issue(asProfile(check.identity)));
        return;
      }

      if (check.reason === 'invalid_credentials') {
        res.status(401).json({ error: 'invalid email or password' });
        return;
      }

      // Suspended by an administrator. 403 like the unconfirmed branch, but with
      // a `code` the client switches on — the two must not share a message.
      // "Confirm your email" shown to a suspended player sends them round a
      // confirmation loop that can never end in a session, and they would call
      // support about the wrong thing entirely.
      //
      // The reason is included when an admin wrote one. A lockout with no
      // explanation is a support ticket every single time, and the admin typed
      // that sentence for this exact moment.
      if (check.reason === 'suspended') {
        res.status(403).json({
          error: check.suspendedReason
            ? `This account is suspended: ${check.suspendedReason}`
            : 'This account is suspended. Contact support.',
          code: 'account_suspended',
        });
        return;
      }

      // 403, not 401. The password was right -- this is a known account that
      // has not finished signing up, and the client needs to tell those apart
      // to send the player to the code screen instead of retrying the password.
      // Safe to disclose: it took the correct password to get here.
      //
      // A FRESH CODE GOES OUT HERE, and that is the whole point of this branch.
      // Someone who signed up yesterday and never confirmed has no live
      // challenge any more, so sending them to a code screen with a resend
      // button would be a dead end: resend refuses when nothing is pending, and
      // sign-up refuses because... nothing, it would reclaim the account -- but
      // only if they guessed that re-registering was the way back in. Two
      // individually-correct rules meeting in a corner with no way out is
      // docs/TRAPS.md #12, and this is where that corner would have been.
      //
      // Mailing from a login is safe precisely because it took the right
      // password to reach: it cannot be aimed at an address the caller does not
      // already control the account for, and the same per-address rate limits
      // apply. `sent` is reported honestly so the screen does not promise a
      // mail that a cooldown or an outage stopped.
      const confirmEmail = check.identity.email ?? identifier;
      const outcome = await mintAndSend(confirmEmail, check.identity.playerId);

      res.status(403).json({
        error: 'Confirm your email address to finish signing up.',
        code: 'email_unverified',
        email: confirmEmail,
        sent: outcome.status === 'sent',
        ...(outcome.status === 'sent'
          ? {
              expiresAt: new Date(outcome.expiresAt).toISOString(),
              resendAvailableAt: new Date(outcome.resendAvailableAt).toISOString(),
            }
          : {}),
        ...(outcome.status === 'rate_limited' ? { retryAfterMs: outcome.retryAfterMs } : {}),
      });
    })().catch((err: unknown) => {
      console.error('[auth] login failed:', err);
      res.status(500).json({ error: 'internal error' });
    });
  });

  // -- Profile & password self-service --------------------------------------
  //
  // Three endpoints. The first two are authenticated and act on the caller's
  // own account (`req.player.playerId` from the bearer token — never a body
  // field); the forgot-password pair is unauthenticated by necessity, since
  // its whole job is recovering an account nobody can currently sign into.

  /**
   * Change the display name on the signed-in account. New name only.
   */
  r.post('/change-display-name', requireAuth(config), (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, string>;
      const raw = body['displayName'];
      if (typeof raw !== 'string') {
        res.status(400).json({ error: 'displayName is required' });
        return;
      }

      const verdict = validateDisplayName(raw);
      if (!verdict.ok) {
        res.status(400).json({ error: verdict.message, code: verdict.code });
        return;
      }

      const identity = await authClient.updateDisplayName(req.player!.playerId, verdict.displayName);
      if (!identity) {
        res.status(404).json({ error: 'account not found' });
        return;
      }
      res.json({ player: asProfile(identity) });
    })().catch((err: unknown) => {
      console.error('[auth] change-display-name failed:', err);
      res.status(500).json({ error: 'internal error' });
    });
  });

  /**
   * Change the password on the signed-in account. Requires the CURRENT
   * password.
   *
   * That check is the entire point of this endpoint. Without it, a bearer
   * token stolen once (a leaked log line, an XSS, a device left unlocked)
   * becomes permanent account theft: the attacker sets a new password and the
   * real owner is locked out for good, rather than just exposed for as long
   * as the token happens to live. The current password is verified through
   * `userStore.changePassword`, which itself calls `userStore.verifyPassword`
   * — the identical path `/auth/login` uses — so this is not a second,
   * possibly-different notion of "the right password".
   *
   * GOOGLE-LINKED ACCOUNTS: an account signed up via Google may have no
   * `passwordHash` at all (see `user.model.ts`). That is refused here with a
   * clear, honest `no_password` — never a generic "wrong password" that would
   * send someone hunting for a password they never set, and never silently
   * treated as a fresh password to create (see the class comment on
   * `/forgot-password` for why this endpoint does not decide that).
   */
  r.post('/change-password', requireAuth(config), (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, string>;
      const currentPassword = body['currentPassword'];
      const newPassword = body['newPassword'];

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'currentPassword and newPassword are required' });
        return;
      }

      const verdict = validatePasswordStrength(newPassword);
      if (!verdict.ok) {
        res.status(400).json({ error: verdict.message, code: verdict.code });
        return;
      }

      const result = await authClient.changePassword(
        req.player!.playerId,
        currentPassword,
        newPassword,
      );

      if (result.ok) {
        res.json({ ok: true });
        return;
      }

      if (result.reason === 'no_password') {
        res.status(400).json({
          error: 'This account signed in with Google and has no password to change.',
          code: 'no_password',
        });
        return;
      }

      if (result.reason === 'no_account') {
        res.status(404).json({ error: 'account not found' });
        return;
      }

      // invalid_current_password -- the guard described above. 400, NOT 401.
      // The bearer token here is valid; only the second, self-supplied secret
      // was wrong, which is a bad-input problem, not an authentication
      // failure -- there is no unauthenticated caller to reject. A 401 is
      // indistinguishable, client-side, from an expired session: the shared
      // HTTP client in the web app treats any 401 as "log the user out", and
      // did exactly that to a real tester who simply mistyped their current
      // password on this form. 400 sits with this endpoint's other
      // credential problems (`password_too_short`, `no_password`) instead.
      res.status(400).json({
        error: 'Current password is incorrect.',
        code: 'invalid_current_password',
      });
    })().catch((err: unknown) => {
      console.error('[auth] change-password failed:', err);
      res.status(500).json({ error: 'internal error' });
    });
  });

  /**
   * Forgot-password, step 1: request a code by email. Unauthenticated, for
   * the obvious reason that its purpose is recovering access nobody currently
   * has.
   *
   * ENUMERATION GUARD, deliberate: this responds with the SAME body and
   * status whether the address belongs to an account or not, and — among
   * accounts that do exist — whether or not that account has a password to
   * reset. A response that varied on any of those would let anyone learn
   * which email addresses are registered on this platform just by trying them
   * here, no password required. A decoy hash runs on every branch that does
   * not mail a code, so the two paths cost comparable wall-clock time; this
   * does not close every timing side-channel (mailing a code is a real
   * network call to financial-core, which a decoy cannot cheaply imitate), but
   * it removes the cheap, obvious one.
   *
   * GOOGLE-LINKED ACCOUNTS: an account with no `passwordHash` gets exactly
   * this same response, but no code is minted and nothing is mailed. There is
   * no password on that account for a code to reset, and minting one anyway
   * would either silently fail later at `/reset-password` (confusing) or
   * silently give that account a password it never had (a product decision,
   * not a bug fix — see the note on `/reset-password` below for why this
   * does not make that call on its own).
   */
  r.post('/forgot-password', (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, string>;
      const raw = body['email'] || body['identifier'];
      if (!raw) {
        res.status(400).json({ error: 'email is required' });
        return;
      }
      const email = normalizeEmail(raw);

      const found = await authClient.findForPasswordReset(email);
      if (found?.hasPassword) {
        await mintAndSend(email, found.playerId);
      } else {
        // Decoy cost only -- see the class comment above. Same hash work as
        // an OTP send, spent on nothing, so a missing or Google-only address
        // does not answer measurably faster than one that got a real code.
        await bcrypt.hash(email, 8);
      }

      res.json({ pending: true, email });
    })().catch((err: unknown) => {
      console.error('[auth] forgot-password failed:', err);
      res.status(500).json({ error: 'internal error' });
    });
  });

  /**
   * Forgot-password, step 2: email + code + new password. Unauthenticated,
   * same reason as step 1.
   *
   * The playerId comes from the verified OTP CHALLENGE, exactly as
   * `/verify-otp` does -- never from anything the client sent -- so a correct
   * code can only ever reset the password of the account it was issued for.
   *
   * This is unreachable for a Google-only account through the public API as
   * built: `/forgot-password` never mints a code for one (see above), so
   * `otps.verify` here answers `no_challenge` before this reaches
   * `userStore.resetPassword`. `resetPassword` itself does not re-check
   * `passwordHash` presence and would happily give such an account its first
   * password if it were ever reached some other way. That is a deliberate
   * choice to leave the store method simple and let the route be the one
   * place that decides who gets a code -- not a claim that letting a Google
   * user add a password is right or wrong. That product decision has not been
   * made; if it should be allowed, it needs a real "add a password" flow with
   * its own explicit UI treatment, not a side effect of this endpoint.
   */
  r.post('/reset-password', (req: Request, res: Response) => {
    void (async (): Promise<void> => {
      const body = (req.body ?? {}) as Record<string, string>;
      const raw = body['email'] || body['identifier'];
      const code = body['code'];
      const newPassword = body['newPassword'];

      if (!raw || !code || !newPassword) {
        res.status(400).json({ error: 'email, code and newPassword are required' });
        return;
      }
      const email = normalizeEmail(raw);

      const verdict = validatePasswordStrength(newPassword);
      if (!verdict.ok) {
        res.status(400).json({ error: verdict.message, code: verdict.code });
        return;
      }

      const result = await otps.verify(email, code, now());
      if (!result.ok) {
        const status = result.reason === 'too_many_attempts' ? 429 : 400;
        const message: Record<typeof result.reason, string> = {
          no_challenge: 'No password reset is pending for this address. Request a new code.',
          expired: 'That code has expired. Request a new one.',
          too_many_attempts: 'Too many incorrect codes. Request a new one.',
          incorrect: 'That code is not correct.',
        };
        res.status(status).json({ error: message[result.reason], code: result.reason });
        return;
      }

      const identity = await authClient.resetPassword(result.playerId, newPassword);
      if (!identity) {
        res
          .status(400)
          .json({ error: 'That account no longer exists.', code: 'no_account' });
        return;
      }

      res.json({ ok: true });
    })().catch((err: unknown) => {
      console.error('[auth] reset-password failed:', err);
      res.status(500).json({ error: 'internal error' });
    });
  });

  r.post('/google', async (req: Request, res: Response) => {
    try {
      // Every OAuth client we accept a token from — web, Android, iOS. Comma
      // separated in GOOGLE_CLIENT_ID.
      const allowedClientIds = (process.env['GOOGLE_CLIENT_ID'] ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      // An empty allow-list used to mean "accept any Google token from any
      // application" — verifyIdToken was simply skipped, and the userinfo
      // fallback trusts whoever the token names without ever checking which
      // client it was issued to. That is the account-takeover bug this fixes.
      // Refusing outright is the only safe reading of "not configured": fail
      // closed, and do it before the token is even looked at.
      if (allowedClientIds.length === 0) {
        res.status(503).json({ error: 'Google sign-in is not configured' });
        return;
      }

      const { idToken, token, credential } = (req.body ?? {}) as Record<string, string>;
      const accessToken = credential || token || idToken;
      if (!accessToken) {
        res.status(400).json({ error: 'Token is required' });
        return;
      }

      let payload: { sub: string; email: string; name?: string; picture?: string } | null = null;

      // A JWT idToken verifies offline; the implicit-flow access_token instead
      // resolves through Google's tokeninfo + userinfo endpoints. Tell them
      // apart by shape (three dot-separated segments), since a JWT that fails
      // audience verification must be rejected outright, never silently
      // retried as an access token.
      const looksLikeJwt = accessToken.split('.').length === 3;

      if (looksLikeJwt) {
        try {
          const ticket = await googleClient.verifyIdToken({
            idToken: accessToken,
            audience: allowedClientIds,
          });
          const p = ticket.getPayload();
          if (p?.email) payload = { sub: p.sub, email: p.email, ...(p.name ? { name: p.name } : {}), ...(p.picture ? { picture: p.picture } : {}) };
        } catch {
          // Well-formed JWT, but it failed verification (bad signature, wrong
          // audience, expired, ...) — reject it outright rather than falling
          // through to the access-token path.
          res.status(401).json({ error: 'Invalid Google token' });
          return;
        }
      } else {
        // Access tokens carry no audience of their own. userinfo reports WHOSE
        // token it is but not which client it was issued to, so on its own it
        // cannot answer "did our app request this?" — that's what tokeninfo's
        // `aud` field is for. Only once that has been checked against the
        // allow-list is it safe to call userinfo for the display profile.
        const tokenInfoRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
        );
        if (!tokenInfoRes.ok) {
          res.status(401).json({ error: 'Invalid Google token' });
          return;
        }
        const tokenInfo = (await tokenInfoRes.json()) as Record<string, string>;
        if (!tokenInfo['aud'] || !allowedClientIds.includes(tokenInfo['aud'])) {
          res.status(401).json({ error: 'Invalid Google token' });
          return;
        }

        const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userinfoRes.ok) {
          const info = (await userinfoRes.json()) as Record<string, string>;
          if (info['email'] && info['sub']) {
            const displayName = info['name'] || info['given_name'] || info['email'].split('@')[0] || 'Player';
            payload = {
              sub: info['sub'],
              email: info['email'],
              name: displayName,
              ...(info['picture'] ? { picture: info['picture'] } : {}),
            };
          }
        }
      }

      if (!payload) {
        res.status(401).json({ error: 'Invalid Google token' });
        return;
      }

      const u = await authClient.oauth(payload.sub, payload.email, payload.name, payload.picture);
      if (!u.ok) {
        // Same words and the same `code` as the password path — a suspended
        // player must not learn that one door is softer than the other.
        res.status(403).json({
          error: u.suspendedReason
            ? `This account is suspended: ${u.suspendedReason}`
            : 'This account is suspended. Contact support.',
          code: 'account_suspended',
        });
        return;
      }
      res.json(issue(asProfile(u.identity)));
    } catch (err) {
      console.error('[auth] Google authentication error:', err);
      res.status(401).json({ error: err instanceof Error ? err.message : 'Google authentication failed' });
    }
  });

  // ── Telegram Mini App sign-in ────────────────────────────────────────────────
  r.post('/telegram', (req: Request, res: Response) => {
    const initData = (req.body as { initData?: unknown } | undefined)?.initData;
    if (typeof initData !== 'string' || !initData) {
      res.status(400).json({ error: 'initData is required' });
      return;
    }

    const result = verifyInitData(initData, config.botToken, {
      maxAgeSeconds: config.initDataMaxAgeSeconds,
    });
    if (!result.ok) {
      // Deliberately 401, not 400: this is a failed authentication, and the
      // reason is safe to return — it tells an honest client what to fix and
      // tells an attacker nothing they couldn't determine by trying.
      res.status(401).json({ error: result.reason });
      return;
    }

    const player = profileFromTelegram(result.user);
    const token = signToken(
      { playerId: player.playerId, role: 'player' },
      config.jwtSecret,
      config.jwtTtlSeconds,
    );
    res.json({ token, player });
  });

  // ── Dev sign-in, for working in a plain browser ──────────────────────────────
  r.post('/dev', (req: Request, res: Response) => {
    if (!config.devAuthBypass) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    // An optional playerId, so local work can hold several identities at once.
    // Anything involving two people — league isolation, a table with opponents,
    // an agent and their referral — is untestable with a single fixed id, and
    // the first attempt at verifying league isolation over HTTP passed
    // vacuously because both 'players' were the same account.
    //
    // Dev-only by construction: this handler 404s unless devAuthBypass is set,
    // which is false everywhere deployed.
    const requested = (req.body as { playerId?: unknown } | undefined)?.playerId;
    const playerId =
      typeof requested === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(requested)
        ? requested
        : 'tg-dev-1';

    const player: PlayerProfile = {
      playerId,
      displayName: playerId === 'tg-dev-1' ? 'Dev Player' : playerId,
      username: 'devplayer',
      photoUrl: null,
      telegramId: null,
      vipTier: 0,
      role: 'player',
    };
    const token = signToken(
      { playerId: player.playerId, role: 'player' },
      config.jwtSecret,
      config.jwtTtlSeconds,
    );
    res.json({ token, player });
  });

  // ── Who am I ─────────────────────────────────────────────────────────────────
  // Confirms a stored token is still good after a reload.
  r.get('/me', requireAuth(config), async (req: Request, res: Response) => {
    try {
      const playerId = req.player!.playerId;
      const telegramId = playerId.startsWith('tg-') ? Number(playerId.slice(3)) : NaN;

      // A missing document is not an error here — Telegram players never have
      // one (see the comment on `userStore.search`): their playerId is derived
      // from the Telegram user id and nothing is ever written for them. For
      // that case only, the profile is derived from the token itself, same as
      // before this lookup existed. `email` and `hasPassword` follow the same
      // rule: null / false for Telegram, never a fabricated address or a
      // guessed password state.
      const stored = await userStore.byPlayerId(playerId);

      // `stored.email` can hold a phone number for a legacy phone sign-up (see
      // `toIdentity` in user-store.ts) — only hand back something that is
      // actually an email address, same guard `internal-routes.ts` uses for
      // the identical field.
      const email = stored?.email?.includes('@') ? stored.email : null;

      res.json({
        playerId,
        displayName: stored?.displayName || playerId,
        username: null,
        photoUrl: stored ? stored.photoUrl ?? null : null,
        telegramId: Number.isFinite(telegramId) ? telegramId : null,
        vipTier: 0,
        // The role rides on the verified token; surfacing it lets the client
        // decide whether to render the admin panel or the player app.
        role: req.player!.role === 'ops' ? 'ops' : 'player',
        email,
        hasPassword: stored?.hasPassword ?? false,
        // `SelfProfile`, not `PlayerProfile`: this is the one endpoint that tells
        // a player about their own account, so it carries the two extra fields
        // Personal Info needs. It still satisfies the narrower shape.
      } satisfies SelfProfile);
    } catch (err) {
      console.error('[auth] /me lookup failed:', err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  return r;
}
