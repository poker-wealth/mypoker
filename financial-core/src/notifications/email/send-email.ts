import { Schema, model } from 'mongoose';
import { mailTransport, mailConfig } from './transport';
import type { EmailTemplate } from './templates';

/**
 * Send one money email, at most once per event.
 *
 * THE DEDUPE IS THE POINT. Deposit crediting and withdrawal transitions are
 * both idempotent and both get retried — a replayed queue message, a dyno
 * restart mid-request, an operator re-running a stuck withdrawal. The ledger
 * absorbs that by design. Email does not: the same eventId arriving twice
 * would put a second "₮500.00 received" in someone's inbox, and a player who
 * receives two deposit receipts has every reason to believe they were charged
 * twice, or that the platform is confused about their money. Support cannot
 * un-send it.
 *
 * The guard is a unique `_id` on the event id, claimed BEFORE the send and
 * released if the send throws. Same shape as notify()'s idempotency, and the
 * database — not this process — is what enforces it, so two dynos racing the
 * same event still produce one email.
 */

interface EmailSendDoc {
  /** The notification event id — one email per event, ever. */
  _id: string;
  to: string;
  subject: string;
  sentAt: Date | null;
  createdAt: Date;
}

const schema = new Schema<EmailSendDoc>(
  {
    _id: { type: String, required: true },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    sentAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'email_sends' },
);

export const EmailSendModel = model<EmailSendDoc>('EmailSend', schema);

export type SendOutcome =
  | 'sent'
  | 'duplicate'
  | 'not_configured'
  | 'no_recipient'
  | 'failed';

/**
 * @param to        recipient address; falsy is a normal outcome, not an error
 * @param eventId   the same id the in-app notification uses for this event
 */
export async function sendEmail(
  to: string | null | undefined,
  template: EmailTemplate,
  eventId: string,
): Promise<SendOutcome> {
  // A player with no address on file is ordinary — Telegram sign-in never asks
  // for one. Nothing to do, and nothing wrong.
  if (!to) return 'no_recipient';

  const transport = mailTransport();
  if (!transport) return 'not_configured';

  // Claim the event first. If this insert loses the race, another worker is
  // already sending it and we stop — better a missing duplicate than a second
  // receipt.
  try {
    await EmailSendModel.create({ _id: eventId, to, subject: template.subject });
  } catch (err) {
    if (isDuplicateKey(err)) return 'duplicate';
    throw err;
  }

  try {
    await transport.sendMail({
      // From the same config the transport was built from — re-reading env here
      // would be a second copy of the fallback rule, free to drift from it.
      from: mailConfig()!.from,
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  } catch (err) {
    // Release the claim so a later retry can try again — a claimed-but-unsent
    // row would silently suppress the receipt forever.
    await EmailSendModel.deleteOne({ _id: eventId }).catch(() => undefined);
    // Never rethrow. This is called from the deposit-credit and withdrawal
    // paths, and a mail server having a bad afternoon must not roll back a
    // player's money.
    console.error(`[email] send failed for ${eventId}:`, err);
    return 'failed';
  }

  // The mail is GONE at this point, so the bookkeeping failing must not
  // release the claim — the old shape had one catch around both, and a DB
  // hiccup in the millisecond after a successful SMTP send deleted the claim,
  // letting a retry send the same receipt twice. The claim row (sentAt null)
  // stands either way; losing the timestamp is the cheap end of that trade.
  try {
    await EmailSendModel.updateOne({ _id: eventId }, { $set: { sentAt: new Date() } });
  } catch (err) {
    console.error(`[email] sent but could not record sentAt for ${eventId}:`, err);
  }
  return 'sent';
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
