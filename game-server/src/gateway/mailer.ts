/**
 * Getting a confirmation code into someone's inbox.
 *
 * The gateway owns identity; financial-core owns the SMTP transport (one
 * mailbox, one connection pool, one dedupe table — see
 * `financial-core/src/notifications/email/`). Rather than give the gateway a
 * second nodemailer with a second copy of the host/port/TLS rules, it asks
 * financial-core to send, over the internal channel that already runs in this
 * direction for every other call.
 *
 * The endpoint is deliberately NARROW: an address, a code, a lifetime. It does
 * not take a subject, a body or any HTML. An internal "send this email" route
 * that accepts caller-supplied content is a spam relay wearing our domain, and
 * the internal secret is shared with more processes than a mail relay should be.
 *
 * FAILING TO SEND IS NOT LIKE FAILING TO SEND A RECEIPT. The money emails
 * deliberately swallow every error, because a receipt is a courtesy and the
 * credit is the product. A confirmation code is the opposite: it is the control
 * itself, and pretending it went out would leave someone waiting for a mail
 * that does not exist. So this reports what happened and the caller decides.
 */

export type OtpDelivery =
  /** In the recipient's mail server's hands. */
  | { outcome: 'sent' }
  /** SMTP is not configured at all. A deployment fault, not a user error. */
  | { outcome: 'not_configured' }
  /** Configured, but the send did not happen. Transient, worth retrying. */
  | { outcome: 'failed'; detail: string };

export interface OtpMailRequest {
  to: string;
  code: string;
  expiresInMinutes: number;
  /**
   * Idempotency key for the send.
   *
   * Derived by the caller from the challenge and its send count, so a retried
   * HTTP request delivers one email while a genuine resend — a different send
   * count — delivers another. A fresh random id per call would defeat the
   * dedupe entirely; a constant one would suppress every resend.
   */
  eventId: string;
}

export type OtpMailer = (request: OtpMailRequest) => Promise<OtpDelivery>;

/** The real sender: an internal call to financial-core. */
export function financialCoreOtpMailer(opts: {
  financialCoreUrl: string;
  internalSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): OtpMailer {
  const base = opts.financialCoreUrl.replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8_000;

  return async (request: OtpMailRequest): Promise<OtpDelivery> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // `/api/v1` is not optional: financial-core mounts its ENTIRE router
      // under that prefix (`http/app.ts`), and every other gateway -> core call
      // carries it. Omitting it 404s, which this maps to 'failed' -- so in
      // production every sign-up would refuse with "we could not send the
      // confirmation email" and nothing would say why.
      //
      // Note the reverse direction reads differently and correctly: the gateway
      // mounts ITS internal routes at the root, which is why
      // financial-core's `gateway-recipient.ts` calls `/internal/...` with no
      // prefix. Two services, two mount points, not one convention.
      const res = await doFetch(`${base}/api/v1/internal/email/otp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': opts.internalSecret,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!res.ok) {
        return { outcome: 'failed', detail: `financial-core responded ${res.status}` };
      }
      const body = (await res.json()) as { outcome?: string };

      // A duplicate means this exact send already went out — the code is in the
      // inbox, which is the outcome the caller cares about, so it counts as sent.
      if (body.outcome === 'sent' || body.outcome === 'duplicate') return { outcome: 'sent' };
      if (body.outcome === 'not_configured') return { outcome: 'not_configured' };
      return { outcome: 'failed', detail: `financial-core outcome ${body.outcome ?? 'unknown'}` };
    } catch (err) {
      // Includes the abort. Never rethrown: the route turns this into a 503 the
      // player can act on, and an unhandled throw here would be a 500 with no
      // explanation on a signup form.
      return { outcome: 'failed', detail: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * What to do when the code cannot be mailed.
 *
 * FAIL CLOSED IN PRODUCTION. An account whose address was never confirmed must
 * not end up with a session because the mail server was down — that is the
 * whole control, and "we could not check, so we allowed it" is how a control
 * becomes decoration.
 *
 * Outside production, with the dev bypass already on, the code is written to
 * the server console instead. That is the only place it is ever revealed: it is
 * NOT put in the HTTP response, because a response field is one deploy-time
 * misconfiguration away from handing every attacker every code, whereas reading
 * it requires the server's own log. The same guard that makes `/auth/dev` a 404
 * everywhere deployed gates this.
 */
export function resolveDeliveryFailure(input: {
  outcome: 'not_configured' | 'failed';
  detail?: string;
  to: string;
  code: string;
  devAuthBypass: boolean;
}): { allow: boolean } {
  if (input.devAuthBypass) {
    console.warn(
      `[auth] email confirmation could not be sent (${input.outcome}${
        input.detail ? `: ${input.detail}` : ''
      }). DEV ONLY — the code for ${input.to} is ${input.code}`,
    );
    return { allow: true };
  }

  console.error(
    `[auth] FATAL: email confirmation could not be sent to ${input.to} (${input.outcome}${
      input.detail ? `: ${input.detail}` : ''
    }). Sign-up is refused until SMTP is configured in financial-core.`,
  );
  return { allow: false };
}
