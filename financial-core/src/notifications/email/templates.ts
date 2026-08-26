/**
 * The money emails.
 *
 * Email HTML is not app HTML. Outlook renders through Word, Gmail strips
 * <style> blocks and anything it does not recognise, and flex/grid are simply
 * unavailable — so this is nested tables with inline styles, and it stays that
 * way however dated it looks.
 *
 * Every template returns `{ subject, html, text }`. The plain-text half is not
 * optional: some clients only take text, every client uses it for the preview
 * line, and a message with no text part scores as spam.
 *
 * AMOUNTS ARE PASSED THROUGH, NEVER RECOMPUTED. Callers hand in the ledger's
 * own decimal string and it is interpolated as-is. Parsing "1234.500000" into a
 * float to make it prettier is how a receipt ends up disagreeing with the
 * balance it is reporting, and the receipt is the thing a player keeps.
 */

/** Brand palette, from SAMUEL.md. Hex only — no CSS variables survive email. */
const C = {
  page: '#0d0d1a',
  card: '#171728',
  border: '#252540',
  brand: '#bb5cf6',
  accent: '#00d4ff',
  text: '#ffffff',
  dim: '#9aa0b4',
} as const;

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/** One row of the details table. */
export interface DetailRow {
  label: string;
  value: string;
  /** Long hashes wrap rather than stretch the table off the screen. */
  wrap?: boolean;
}

/** Escape anything interpolated into HTML — tx hashes and addresses are opaque. */
const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * The shared shell: wordmark, heading, the amount, a details table, footer.
 *
 * Every event fills the middle and nothing else, so a deposit receipt and a
 * withdrawal receipt are recognisably the same family of message.
 */
interface LayoutInput {
  heading: string;
  /** The one big line. An amount for money mail; the code for a confirmation. */
  amount: string;
  amountNote: string;
  rows: DetailRow[];
  supportUrl: string;
  /**
   * Why this person is being written to. Defaults to the wallet-activity line,
   * which is true of every money email and false of a confirmation code — the
   * recipient of one of those has no wallet activity and may have no account.
   */
  footerNote?: string;
  /** Renders the big line as spaced monospace. For codes, not amounts. */
  mono?: boolean;
}

const DEFAULT_FOOTER =
  'You are receiving this because this address is on a MYPOKER account with wallet activity.';

function layout(input: LayoutInput): string {
  const rows = input.rows
    .map(
      (r) => `
              <tr>
                <td style="padding:8px 0;color:${C.dim};font-size:13px;white-space:nowrap;">${esc(r.label)}</td>
                <td style="padding:8px 0;color:${C.text};font-size:13px;text-align:right;${
                  r.wrap ? 'word-break:break-all;' : 'white-space:nowrap;'
                }">${esc(r.value)}</td>
              </tr>`,
    )
    .join('');

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.page};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${C.card};border:1px solid ${C.border};border-radius:14px;">
          <tr>
            <td style="padding:24px 24px 0 24px;">
              <div style="font-size:16px;font-weight:800;letter-spacing:2px;color:${C.brand};">MYPOKER</div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 24px 0 24px;">
              <div style="font-size:15px;color:${C.text};">${esc(input.heading)}</div>
              <div style="font-size:34px;font-weight:800;color:${C.text};padding-top:6px;${
                input.mono
                  ? `font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;letter-spacing:6px;`
                  : ''
              }">${esc(input.amount)}</div>
              <div style="font-size:12px;color:${C.dim};padding-top:4px;">${esc(input.amountNote)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 24px 0 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="border-top:1px solid ${C.border};">
                ${rows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px 24px 24px;">
              <div style="font-size:11px;color:${C.dim};line-height:1.6;">
                Questions? <a href="${esc(input.supportUrl)}" style="color:${C.accent};text-decoration:none;">Contact support</a>.<br>
                ${esc(input.footerNote ?? DEFAULT_FOOTER)}
              </div>
              <div style="font-size:10px;color:${C.dim};padding-top:14px;letter-spacing:1px;">
                Fair. On-Chain. Always.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** The text half, built from the same inputs so the two cannot drift. */
function plain(input: LayoutInput): string {
  const rows = input.rows.map((r) => `${r.label}: ${r.value}`).join('\n');
  return [
    'MYPOKER',
    '',
    input.heading,
    input.amount,
    input.amountNote,
    '',
    rows,
    '',
    `Questions? ${input.supportUrl}`,
    input.footerNote ?? DEFAULT_FOOTER,
    '',
    'Fair. On-Chain. Always.',
  ].join('\n');
}

const SUPPORT = process.env.SUPPORT_URL ?? 'https://mypoker777.com';

/** A ledger decimal string as players read it: ₮20.00 from "20.000000". */
export function displayAmount(decimal: string): string {
  const [whole = '0', frac = ''] = decimal.split('.');
  // Two places, truncated not rounded — a receipt must never claim a cent the
  // ledger did not move.
  return `₮${whole}.${(frac + '00').slice(0, 2)}`;
}

// ── the three events ─────────────────────────────────────────────────────────

export function depositReceived(input: {
  /** Ledger decimal string. */
  amount: string;
  txHash: string;
  network: string;
  at: Date;
}): EmailTemplate {
  const amount = displayAmount(input.amount);
  const body = {
    heading: 'Deposit received',
    amount: `${amount} received`,
    amountNote: 'Credited to your wallet and available now.',
    rows: [
      { label: 'Amount', value: amount },
      { label: 'Network', value: input.network },
      { label: 'Transaction', value: input.txHash, wrap: true },
      { label: 'Time', value: input.at.toUTCString() },
      { label: 'Status', value: 'Credited' },
    ],
    supportUrl: SUPPORT,
  };
  return { subject: `${amount} deposited`, html: layout(body), text: plain(body) };
}

export function withdrawalRequested(input: {
  amount: string;
  address: string;
  at: Date;
}): EmailTemplate {
  const amount = displayAmount(input.amount);
  const body = {
    heading: 'Withdrawal requested',
    amount: `Withdrawal of ${amount}`,
    // Deliberately plain. "Pending review" invites the reading that something
    // is wrong; this states what happens next and nothing more.
    amountNote: 'We have your request. You will get another email when it is sent.',
    rows: [
      { label: 'Amount', value: amount },
      { label: 'To address', value: input.address, wrap: true },
      { label: 'Requested', value: input.at.toUTCString() },
      { label: 'Status', value: 'Requested' },
    ],
    supportUrl: SUPPORT,
  };
  return { subject: `Withdrawal of ${amount} requested`, html: layout(body), text: plain(body) };
}

export function withdrawalSent(input: {
  amount: string;
  address: string;
  txHash: string;
  network: string;
  at: Date;
}): EmailTemplate {
  const amount = displayAmount(input.amount);
  const body = {
    heading: 'Withdrawal sent',
    amount: `${amount} sent`,
    amountNote: 'Broadcast to the network. Arrival depends on confirmations.',
    rows: [
      { label: 'Amount', value: amount },
      { label: 'To address', value: input.address, wrap: true },
      { label: 'Network', value: input.network },
      { label: 'Transaction', value: input.txHash, wrap: true },
      { label: 'Sent', value: input.at.toUTCString() },
      { label: 'Status', value: 'Sent' },
    ],
    supportUrl: SUPPORT,
  };
  return { subject: `${amount} sent`, html: layout(body), text: plain(body) };
}

// ── identity ─────────────────────────────────────────────────────────────────

/**
 * The email-confirmation code.
 *
 * Not a money email, but the same shell on purpose: someone who has seen a
 * MYPOKER deposit receipt should recognise this one as coming from the same
 * place, and a confirmation mail that looks unlike the rest of the brand is
 * indistinguishable from a phishing attempt.
 *
 * A CODE, NOT A LINK. Corporate mail scanners and some clients pre-fetch every
 * URL in a message, which would silently consume a one-click confirmation link
 * before the recipient ever saw it. A code cannot be spent by a scanner.
 *
 * Says plainly what to do if it was not you. That sentence is the only
 * protection the person whose address was typed in by mistake — or on purpose —
 * actually has.
 */
export function emailConfirmationCode(input: {
  code: string;
  expiresInMinutes: number;
}): EmailTemplate {
  const body = {
    heading: 'Confirm your email address',
    amount: input.code,
    amountNote: `This code expires in ${input.expiresInMinutes} minutes.`,
    mono: true,
    rows: [
      { label: 'Code', value: input.code },
      { label: 'Valid for', value: `${input.expiresInMinutes} minutes` },
    ],
    supportUrl: SUPPORT,
    // "nobody can sign in without it", NOT "no account is created without it".
    // The account row IS written before this email is sent — it just cannot
    // hold a session and is reclaimed by the next sign-up for the address. The
    // shorter sentence read better and was false, which is docs/TRAPS.md #7 in
    // a place a player actually reads.
    footerNote:
      'You are receiving this because someone entered this address when signing up for MYPOKER. ' +
      'If that was not you, ignore this email — the code expires on its own and nobody can sign in without it.',
  };
  return {
    subject: `${input.code} is your MYPOKER confirmation code`,
    html: layout(body),
    text: plain(body),
  };
}
