import { Router, type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { userStore } from '../auth/user-store';
import type { GatewayConfig } from './config';

/**
 * Service-to-service routes — financial-core asking the gateway a question.
 *
 * This is the FIRST inbound internal route on the gateway; every other call has
 * run the other way. The direction is worth justifying rather than assuming.
 *
 * financial-core knows a deposit landed and for which playerId. It does NOT
 * know that player's email address, and should not: it holds accounts keyed by
 * playerId and no personal data, which is why a breach there exposes balances
 * but not identities. Identity lives here.
 *
 * The alternatives were worse. Copying every address into financial-core puts
 * personal data in a second database — two breach surfaces, two deletion paths
 * for an erasure request, and a stale copy whose only symptom is a receipt sent
 * to an address someone abandoned. Having the gateway send the emails does not
 * work at all: the deposit watcher runs inside financial-core and credits
 * autonomously, so the gateway never learns a deposit happened.
 *
 * docs/handoff/02-architecture.md draws the arrow gateway → financial-core but
 * does not forbid the reverse, and financial-core already calls outward (it
 * polls TronGrid for deposits). So this is a new edge, not a broken rule.
 *
 * The failure mode is already handled: the caller wraps this in a try/catch
 * that swallows, so a gateway outage costs an email, never a credit.
 *
 * NOTE: only Telegram-less accounts ever reach here. A Telegram player's chat
 * id is inside their playerId, so the majority of notifications need no lookup
 * at all.
 */

/**
 * The same guard financial-core uses, mirrored.
 *
 * Constant-time, and an unset secret rejects everything rather than matching
 * the empty string — a deployment that forgot to configure it must fail closed,
 * not open.
 */
function internalAuth(config: GatewayConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = Buffer.from(req.header('x-internal-secret') ?? '');
    const expected = Buffer.from(config.internalApiSecret);
    if (
      expected.length === 0 ||
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      res.status(401).json({ error: 'invalid internal credentials' });
      return;
    }
    next();
  };
}

export function buildInternalRouter(config: GatewayConfig): Router {
  const r = Router();
  r.use(internalAuth(config));

  /**
   * One player's contactable email address, or null.
   *
   * Returns ONLY the address. Not the display name, not the phone, not the
   * creation date — a service asking "where do I send this receipt" has no
   * business receiving a profile, and an endpoint that returns more than its
   * caller needs is how a narrow question becomes a data export.
   *
   * 200 with null rather than 404 for an unknown player: "no address" is a
   * normal, expected answer here (every Telegram account), not a failure.
   */
  r.get('/players/:playerId/email', (req: Request, res: Response): void => {
    void (async (): Promise<void> => {
      try {
        const identity = await userStore.byPlayerId(String(req.params.playerId));
        // `email` also carries a phone number for phone sign-ups, which is not
        // a mailbox — only return something that can actually receive mail.
        const email = identity?.email?.includes('@') ? identity.email : null;
        res.json({ email });
      } catch (err) {
        console.error('[internal] email lookup failed:', err);
        res.status(500).json({ error: 'lookup failed' });
      }
    })();
  });

  return r;
}
