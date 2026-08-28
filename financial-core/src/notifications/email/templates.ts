import { MESSAGES, fill, DEFAULT_LOCALE, type Locale, type EmailMessages } from './messages';

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
function layout(input: {
  heading: string;
  amount: string;
  amountNote: string;
  rows: DetailRow[];
  supportUrl: string;
  footer: EmailMessages['footer'];
}): string {
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
              <div style="font-size:34px;font-weight:800;color:${C.text};padding-top:6px;">${esc(input.amount)}</div>
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
                ${esc(input.footer.questions)} <a href="${esc(input.supportUrl)}" style="color:${C.accent};text-decoration:none;">${esc(input.footer.contactSupport)}</a><br>
                ${esc(input.footer.why)}
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
function plain(input: {
  heading: string;
  amount: string;
  amountNote: string;
  rows: DetailRow[];
  supportUrl: string;
  footer: EmailMessages['footer'];
}): string {
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
    `${input.footer.questions} ${input.supportUrl}`,
    input.footer.why,
    '',
    // The tagline stays English in every locale: it is the brand wordmark's
    // companion, not copy. Translating it would give the brand eight names.
    'Fair. On-Chain. Always.',
  ].join('\n');
}

const SUPPORT = process.env.SUPPORT_URL ?? 'https://mypoker777.com';

/**
 * A ledger decimal string as players read it: "20.00" from "20.000000".
 *
 * DIGITS ONLY, NO CURRENCY MARK. The mark belongs to the phrase — every locale
 * places it differently — so each string in messages.ts carries its own `$` and
 * this returns a bare number. Putting one here too is how `$$20.00` reaches an
 * inbox (docs/TRAPS.md #4, three times on the frontend already).
 */
export function formatAmount(decimal: string): string {
  const [whole = '0', frac = ''] = decimal.split('.');
  // Two places, truncated not rounded — a receipt must never claim a cent the
  // ledger did not move.
  return `${whole}.${(frac + '00').slice(0, 2)}`;
}

// ── the three events ─────────────────────────────────────────────────────────

export function depositReceived(input: {
  /** Ledger decimal string. */
  amount: string;
  txHash: string;
  network: string;
  at: Date;
  /** The player's language. Defaults to English when they have not chosen one. */
  locale?: Locale;
}): EmailTemplate {
  const m = MESSAGES[input.locale ?? DEFAULT_LOCALE];
  const amount = formatAmount(input.amount);
  const body = {
    heading: m.deposit.heading,
    amount: fill(m.deposit.amountLine, { amount }),
    amountNote: m.deposit.note,
    rows: [
      // The row VALUE is the bare number: the label already says "Amount", so a
      // mark here would be the only place in the mail it appears twice.
      { label: m.labels.amount, value: amount },
      { label: m.labels.network, value: input.network },
      { label: m.labels.transaction, value: input.txHash, wrap: true },
      { label: m.labels.dateTime, value: input.at.toUTCString() },
      { label: m.labels.status, value: m.status.credited },
    ],
    supportUrl: SUPPORT,
    footer: m.footer,
  };
  return {
    subject: fill(m.deposit.subject, { amount }),
    html: layout(body),
    text: plain(body),
  };
}

export function withdrawalRequested(input: {
  amount: string;
  address: string;
  at: Date;
  locale?: Locale;
}): EmailTemplate {
  const m = MESSAGES[input.locale ?? DEFAULT_LOCALE];
  const amount = formatAmount(input.amount);
  const body = {
    heading: m.withdrawalRequested.heading,
    amount: fill(m.withdrawalRequested.amountLine, { amount }),
    amountNote: m.withdrawalRequested.note,
    rows: [
      { label: m.labels.amount, value: amount },
      { label: m.labels.toAddress, value: input.address, wrap: true },
      { label: m.labels.requested, value: input.at.toUTCString() },
      { label: m.labels.status, value: m.status.requested },
    ],
    supportUrl: SUPPORT,
    footer: m.footer,
  };
  return {
    subject: fill(m.withdrawalRequested.subject, { amount }),
    html: layout(body),
    text: plain(body),
  };
}

export function withdrawalSent(input: {
  amount: string;
  address: string;
  txHash: string;
  network: string;
  at: Date;
  locale?: Locale;
}): EmailTemplate {
  const m = MESSAGES[input.locale ?? DEFAULT_LOCALE];
  const amount = formatAmount(input.amount);
  const body = {
    heading: m.withdrawalSent.heading,
    amount: fill(m.withdrawalSent.amountLine, { amount }),
    amountNote: m.withdrawalSent.note,
    rows: [
      { label: m.labels.amount, value: amount },
      { label: m.labels.toAddress, value: input.address, wrap: true },
      { label: m.labels.network, value: input.network },
      { label: m.labels.transaction, value: input.txHash, wrap: true },
      { label: m.labels.sent, value: input.at.toUTCString() },
      { label: m.labels.status, value: m.status.sent },
    ],
    supportUrl: SUPPORT,
    footer: m.footer,
  };
  return {
    subject: fill(m.withdrawalSent.subject, { amount }),
    html: layout(body),
    text: plain(body),
  };
}

/**
 * Money that arrived but will never be credited (spec §3.7: wrong contract).
 *
 * NOT a receipt — the one message here that is bad news. Someone sent real
 * funds to a contract the platform does not accept, and the transaction id is
 * what support needs to help them, so it is the most prominent row.
 */
export function depositRejected(input: {
  amount: string;
  txHash: string;
  network: string;
  at: Date;
  locale?: Locale;
}): EmailTemplate {
  const m = MESSAGES[input.locale ?? DEFAULT_LOCALE];
  const amount = formatAmount(input.amount);
  const body = {
    heading: m.depositRejected.heading,
    amount: fill(m.depositRejected.amountLine, { amount }),
    amountNote: m.depositRejected.note,
    rows: [
      { label: m.labels.amount, value: amount },
      { label: m.labels.network, value: input.network },
      { label: m.labels.transaction, value: input.txHash, wrap: true },
      { label: m.labels.dateTime, value: input.at.toUTCString() },
      { label: m.labels.status, value: m.status.notCredited },
    ],
    supportUrl: SUPPORT,
    footer: m.footer,
  };
  return {
    subject: fill(m.depositRejected.subject, { amount }),
    html: layout(body),
    text: plain(body),
  };
}

/** Money out, step three — it is on-chain final. The end of the story. */
export function withdrawalConfirmed(input: {
  amount: string;
  address: string;
  txHash: string;
  network: string;
  at: Date;
  locale?: Locale;
}): EmailTemplate {
  const m = MESSAGES[input.locale ?? DEFAULT_LOCALE];
  const amount = formatAmount(input.amount);
  const body = {
    heading: m.withdrawalConfirmed.heading,
    amount: fill(m.withdrawalConfirmed.amountLine, { amount }),
    amountNote: m.withdrawalConfirmed.note,
    rows: [
      { label: m.labels.amount, value: amount },
      { label: m.labels.toAddress, value: input.address, wrap: true },
      { label: m.labels.network, value: input.network },
      { label: m.labels.transaction, value: input.txHash, wrap: true },
      { label: m.labels.sent, value: input.at.toUTCString() },
      { label: m.labels.status, value: m.status.completed },
    ],
    supportUrl: SUPPORT,
    footer: m.footer,
  };
  return {
    subject: fill(m.withdrawalConfirmed.subject, { amount }),
    html: layout(body),
    text: plain(body),
  };
}

/**
 * A withdrawal that did not happen, and the money is back.
 *
 * Covers BOTH an operator refusing it and a broadcast that failed, because the
 * player's position is identical either way: the payout did not occur and the
 * balance is whole again. Stating a cause we cannot always know would be worse
 * than stating the outcome we always do.
 */
export function withdrawalReturned(input: {
  amount: string;
  address: string;
  at: Date;
  locale?: Locale;
}): EmailTemplate {
  const m = MESSAGES[input.locale ?? DEFAULT_LOCALE];
  const amount = formatAmount(input.amount);
  const body = {
    heading: m.withdrawalReturned.heading,
    amount: fill(m.withdrawalReturned.amountLine, { amount }),
    amountNote: m.withdrawalReturned.note,
    rows: [
      { label: m.labels.amount, value: amount },
      { label: m.labels.toAddress, value: input.address, wrap: true },
      { label: m.labels.dateTime, value: input.at.toUTCString() },
      { label: m.labels.status, value: m.status.returned },
    ],
    supportUrl: SUPPORT,
    footer: m.footer,
  };
  return {
    subject: fill(m.withdrawalReturned.subject, { amount }),
    html: layout(body),
    text: plain(body),
  };
}
