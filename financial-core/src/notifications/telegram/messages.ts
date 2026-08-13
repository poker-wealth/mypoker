/**
 * The Telegram message bodies.
 *
 * Short, because they arrive as a chat message rather than a document. A player
 * glancing at a phone notification needs the amount and what happened; the
 * detail belongs in the app, which is one tap away.
 *
 * Amounts are the ledger's own decimal string, interpolated and never parsed
 * into a float. A receipt that disagrees with the balance is the one message a
 * player screenshots and sends to support.
 *
 * HTML parse mode, so anything interpolated must be escaped — a display name or
 * a tx hash containing `<` would otherwise break the message or, worse, be
 * rendered as markup.
 */

/** Escape the five characters Telegram's HTML mode treats as markup. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ₮ and two decimals, truncated — never rounded up past what the ledger moved. */
export function amount(decimal: string): string {
  const [whole = '0', frac = ''] = decimal.split('.');
  return `₮${whole}.${(frac + '00').slice(0, 2)}`;
}

export function depositReceived(input: { amount: string; txHash?: string | undefined }): string {
  const lines = [
    `<b>${amount(input.amount)} received</b>`,
    '',
    'Your deposit has been credited and is ready to play.',
  ];
  if (input.txHash) lines.push('', `<code>${esc(input.txHash)}</code>`);
  return lines.join('\n');
}

export function withdrawalRequested(input: { amount: string; address: string }): string {
  return [
    `<b>Withdrawal of ${amount(input.amount)} requested</b>`,
    '',
    `To <code>${esc(input.address)}</code>`,
    '',
    // This is the message that reaches someone whose account was used without
    // them. It has to say what to do, not just what happened.
    "If this wasn't you, contact support immediately.",
  ].join('\n');
}

export function withdrawalSent(input: { amount: string; txHash: string }): string {
  return [
    `<b>${amount(input.amount)} sent</b>`,
    '',
    'Your withdrawal has been broadcast to the network.',
    '',
    `<code>${esc(input.txHash)}</code>`,
  ].join('\n');
}

/**
 * A deposit that will never be credited (spec: "send to wrong contract → no
 * credit, TG notification sent").
 *
 * The one message here that is not a receipt. A player who sent real funds to
 * the wrong contract has lost them unless someone helps, and silence is the
 * worst possible response — they would assume the deposit was simply slow.
 */
export function nonOfficialContract(input: { txHash: string }): string {
  return [
    '<b>Deposit not credited</b>',
    '',
    'This transfer used a token contract the platform does not accept, so no funds were added.',
    '',
    `<code>${esc(input.txHash)}</code>`,
    '',
    'Contact support with this transaction id.',
  ].join('\n');
}
