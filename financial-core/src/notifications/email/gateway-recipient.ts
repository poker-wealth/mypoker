import { setRecipientResolver, type RecipientResolver } from './money-mail';

/**
 * Resolve a player's email address by asking the gateway.
 *
 * The address lives with identity, in the gateway. This service holds accounts
 * keyed by playerId and no personal data — which is the point, and why the
 * address is fetched per event and never stored here. Copying every address
 * into this database would create a second place to breach, a second erasure
 * path to honour on request, and a stale copy whose only symptom is a receipt
 * going somewhere abandoned.
 *
 * Only web sign-ups ever reach this. A Telegram player's chat id is inside
 * their playerId, so they are notified without any lookup at all — see
 * notifications/telegram/send-telegram.ts.
 *
 * Returns null on ANY failure, deliberately. Null means "no email", which the
 * send path already treats as a normal outcome, so an unreachable gateway
 * costs a receipt and never a credit.
 */
export function gatewayRecipientResolver(opts: {
  gatewayUrl: string;
  internalSecret: string;
  fetchImpl?: typeof fetch;
  /** Guard against a hung gateway holding a money path open. */
  timeoutMs?: number;
}): RecipientResolver {
  const base = opts.gatewayUrl.replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 3_000;

  return async (playerId: string): Promise<string | null> => {
    // Not even worth a request: `tg-*` accounts have no mailbox by definition.
    if (/^tg-\d+$/.test(playerId)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(
        `${base}/internal/players/${encodeURIComponent(playerId)}/email`,
        { headers: { 'x-internal-secret': opts.internalSecret }, signal: controller.signal },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { email?: string | null };
      return body.email ?? null;
    } catch (err) {
      console.error(`[recipient] lookup failed for ${playerId}:`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Install the gateway lookup from the environment. Returns whether it was.
 *
 * EVERY PROCESS THAT CREDITS MONEY MUST CALL THIS. It exists because the wiring
 * used to live inline in src/index.ts, which meant the API had it and the
 * deposit watcher did not — and the watcher is the only thing that credits a
 * real on-chain deposit. Without a resolver installed, `resolveRecipient`
 * returns null, sendEmail reports 'no_recipient', and that is indistinguishable
 * from a Telegram player who legitimately has no mailbox: no error, no log, no
 * row in email_sends. Every real deposit went uncredited by email and nothing
 * anywhere said so.
 *
 * The caller logs the result. A money process that cannot email should say so
 * at startup rather than be discovered by a player who never got a receipt.
 */
export function installGatewayRecipientFromEnv(internalSecret: string): boolean {
  const gatewayUrl = process.env.GATEWAY_URL;
  if (!gatewayUrl) return false;
  setRecipientResolver(gatewayRecipientResolver({ gatewayUrl, internalSecret }));
  return true;
}
