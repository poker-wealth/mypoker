import nodemailer, { type Transporter } from 'nodemailer';

/**
 * The one Nodemailer transport, built from the environment.
 *
 * Credentials are never in code. The SMTP account is an owner dependency
 * (Hostinger mailbox for mypoker777.com), supplied as:
 *
 *   SMTP_HOST   smtp.hostinger.com
 *   SMTP_PORT   465 (implicit TLS) or 587 (STARTTLS)
 *   SMTP_USER   the full address — no-reply@mypoker777.com
 *   SMTP_PASS   the mailbox password, not the hosting account password
 *   EMAIL_FROM  "MYPOKER <no-reply@mypoker777.com>"
 *
 * ONE transport for the process, not one per send. Nodemailer pools
 * connections on the transport, so building a fresh one per email opens a new
 * SMTP conversation each time — which is slow, and which shared hosts treat as
 * abuse and rate-limit.
 *
 * UNCONFIGURED IS A VALID STATE, not an error. Until the mailbox exists,
 * `mailTransport()` returns null and `sendEmail` logs and returns instead of
 * sending. A missing SMTP password must never be able to fail a deposit
 * credit — the money is the product, the receipt is a courtesy.
 */

export interface MailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/** Read SMTP settings from the environment, or null when they are incomplete. */
export function mailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  // `||`, not `??`: a .env line reading `SMTP_PORT=` with no value yields an
  // empty string, which is not nullish — Number('') is 0, and `??` would let
  // that 0 fail the check below and silently disable email with HOST/USER/PASS
  // all present. Blank means "the default", same as absent.
  const port = Number(SMTP_PORT || 465);
  if (!Number.isInteger(port) || port <= 0) return null;

  return {
    host: SMTP_HOST,
    port,
    user: SMTP_USER,
    pass: SMTP_PASS,
    // Falling back to the mailbox address keeps a misconfigured EMAIL_FROM from
    // producing mail with an empty sender, which every provider rejects. `||`
    // for the same blank-line reason as the port.
    from: EMAIL_FROM || SMTP_USER,
  };
}

let cached: Transporter | null | undefined;

/**
 * The shared transport, or null when SMTP is not configured.
 *
 * Cached after the first call, including the null — the environment does not
 * change under a running process, and re-reading it per send would let a
 * deploy that dropped a variable start silently building new transports.
 */
export function mailTransport(env: NodeJS.ProcessEnv = process.env): Transporter | null {
  if (cached !== undefined) return cached;

  const config = mailConfig(env);
  if (!config) {
    console.warn('[email] SMTP not configured — money receipts will not be sent');
    cached = null;
    return cached;
  }

  cached = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 is implicit TLS; 587 upgrades via STARTTLS. Getting this wrong hangs
    // the connection rather than failing cleanly, which is why it is derived
    // from the port rather than configured separately.
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
  return cached;
}

/** Test seam — drops the cached transport so a test can vary the environment. */
export function resetMailTransport(): void {
  cached = undefined;
}
