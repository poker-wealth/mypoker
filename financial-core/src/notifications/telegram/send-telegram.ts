import { Schema, model } from 'mongoose';

/**
 * Telegram notifications for money movements.
 *
 * THIS IS THE SPEC'S CHANNEL, not email. The specs never mention email once;
 * they name Telegram throughout — "TG notification on auto-transfer
 * completion", "wrong contract → no credit, TG notification sent to player",
 * and a measured budget of "tap to TG notification <15 seconds" on withdrawals.
 *
 * It also has no address problem, which is why it can ship today while email
 * cannot. A Telegram player's id IS their chat id: `playerIdForTelegramUser`
 * returns `tg-${telegramUserId}`, so the destination is already in the
 * playerId that every money event carries. Nothing to look up, nothing to
 * copy, no PII to hold.
 *
 * Email remains the fallback for web sign-ups, who have no Telegram to reach.
 */

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * One row per event announced on Telegram — the dedupe guard.
 *
 * Its own collection rather than the email one. Both channels dedupe on the
 * same event id, so sharing a table would mean the first channel to send
 * claimed the event and silenced the other: a player would get the Telegram
 * message and lose the email, or the reverse, depending on ordering. One
 * record per channel per event keeps them independent.
 */
interface TelegramSendDoc {
  _id: string;
  chatId: string;
  sentAt: Date | null;
  createdAt: Date;
}

const schema = new Schema<TelegramSendDoc>(
  {
    _id: { type: String, required: true },
    chatId: { type: String, required: true },
    sentAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'telegram_sends' },
);

export const TelegramSendModel = model<TelegramSendDoc>('TelegramSend', schema);

/** `tg-4471` → `4471`, or null for a web account with no Telegram. */
export function chatIdOf(playerId: string): string | null {
  const match = /^tg-(\d+)$/.exec(playerId);
  return match ? match[1]! : null;
}

export type TelegramResult = 'sent' | 'not_telegram' | 'not_configured' | 'duplicate' | 'failed';

/**
 * Send one message, once per event.
 *
 * Deduped on the event id in this channel's own collection, so a player cannot
 * get two Telegram messages for one deposit — and cannot lose the email
 * because the Telegram send claimed the event first.
 *
 * The claim is taken BEFORE the send and released if it fails, so a Telegram
 * outage does not permanently suppress a notification the player should have
 * had.
 */
export async function sendTelegram(
  playerId: string,
  text: string,
  eventId: string,
  deps: { botToken?: string | undefined; fetchImpl?: typeof fetch } = {},
): Promise<TelegramResult> {
  const chatId = chatIdOf(playerId);
  if (!chatId) return 'not_telegram';

  const botToken = deps.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  // No token is the dev default, not an error: money paths run normally and
  // send nothing, exactly as the email transport behaves without SMTP.
  if (!botToken) return 'not_configured';

  try {
    await TelegramSendModel.create({ _id: eventId, chatId });
  } catch (err) {
    // ONLY a duplicate key means "already announced". Anything else — Mongo
    // down, say — wrote no claim, so calling it a duplicate would be a lie
    // that also happens to skip the message; the email path next door has
    // always made this distinction.
    if (isDuplicateKey(err)) return 'duplicate';
    console.error(`[telegram] could not claim ${eventId}:`, err);
    return 'failed';
  }

  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        // A money receipt should not unfurl a link preview over itself.
        disable_web_page_preview: true,
      }),
      // Awaited (guarded) from the deposit and withdrawal paths: a blackholed
      // api.telegram.org must stall a credit by seconds at most, not by
      // undici's multi-minute default.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`telegram sendMessage: HTTP ${res.status}`);
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (!body.ok) throw new Error(`telegram sendMessage: ${body.description ?? 'refused'}`);
  } catch (err) {
    // Release the claim so a later retry can still deliver it.
    await TelegramSendModel.deleteOne({ _id: eventId }).catch(() => undefined);
    console.error(`[telegram] send failed for ${eventId}:`, err);
    return 'failed';
  }

  // The message is delivered; bookkeeping failing must not release the claim,
  // or a retry re-sends what the player already has. Same trade as the email
  // path: better a missing timestamp than a second receipt.
  try {
    await TelegramSendModel.updateOne({ _id: eventId }, { $set: { sentAt: new Date() } });
  } catch (err) {
    console.error(`[telegram] sent but could not record sentAt for ${eventId}:`, err);
  }
  return 'sent';
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
