import { Schema, model } from 'mongoose';
import { devicesFor, forgetPushToken } from './push-token-store';

/**
 * Push notifications for the native app.
 *
 * The fourth channel, and the only one that reaches a player whose phone is in
 * their pocket. Telegram already does that for Telegram players — the bot
 * messages them whether or not the Mini App is open — but a native install has
 * nothing equivalent: before this, a deposit was stored, badged, and invisible
 * until the player next opened the app.
 *
 * Sent through EXPO'S PUSH SERVICE rather than to APNs and FCM directly. Expo
 * holds the platform credentials for the EAS project and fans one request out
 * to both, so this file has one destination instead of two, no certificate
 * handling, and no per-platform payload shapes. The cost is a dependency on
 * their relay; the alternative is two transports and two credential rotations
 * inside the money service.
 *
 * ── What still has to happen outside this repo ─────────────────────────────
 *
 * Nothing here delivers anything until the EAS project carries the platform
 * credentials: a Firebase project (FCM) for Android, an Apple Developer account
 * for iOS. Android can go live on its own — the two are independent, and
 * `devicesFor` returns whatever is registered. Until then this returns
 * `not_configured` and the other three channels behave exactly as before.
 *
 * Modelled on send-telegram.ts on purpose: same claim-before-send dedupe in its
 * own collection, same "no credential is the dev default, not an error", same
 * injectable deps. Two channels that behave differently under retry is how you
 * get a player with one email and three notifications.
 */

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';

/**
 * One row per event pushed — this channel's own dedupe guard.
 *
 * Its own collection, for the reason telegram_sends gives: channels sharing a
 * dedupe table means the first to send claims the event and silences the rest,
 * so a player would get the push and lose the email depending on ordering.
 */
interface PushSendDoc {
  _id: string;
  playerId: string;
  sentAt: Date | null;
  createdAt: Date;
}

const schema = new Schema<PushSendDoc>(
  {
    _id: { type: String, required: true },
    playerId: { type: String, required: true },
    sentAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'push_sends' },
);

export const PushSendModel = model<PushSendDoc>('PushSend', schema);

export type PushResult = 'sent' | 'no_devices' | 'not_configured' | 'duplicate' | 'failed';

export interface PushMessage {
  title: string;
  body: string;
  /** Rides along to the app so a tap can open the right screen. */
  data?: Record<string, string>;
}

/** One ticket back from Expo, per message sent. */
interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Send one notification to every device a player holds, once per event.
 *
 * The claim is taken BEFORE the send and released if the whole send fails, so
 * an Expo outage does not permanently suppress a notification the player should
 * have had.
 */
export async function sendPush(
  playerId: string,
  message: PushMessage,
  eventId: string,
  deps: { accessToken?: string | undefined; fetchImpl?: typeof fetch } = {},
): Promise<PushResult> {
  // Expo accepts unauthenticated pushes, but an access token means a stolen
  // push token cannot be used by anyone else to send to our players. Its
  // absence is the dev default, not an error: money paths run normally and send
  // nothing, exactly as Telegram and email behave without their credentials.
  const accessToken = deps.accessToken ?? process.env.EXPO_ACCESS_TOKEN;
  if (!accessToken) return 'not_configured';

  const devices = await devicesFor(playerId);
  // Not a failure. A Telegram-only player, or one who has never installed the
  // app, legitimately has no devices — and the in-app notification is already
  // stored for whenever they do.
  if (devices.length === 0) return 'no_devices';

  try {
    await PushSendModel.create({ _id: eventId, playerId });
  } catch (err) {
    // ONLY a duplicate key means "already pushed". Anything else — Mongo down —
    // wrote no claim, so calling it a duplicate would be a lie that also
    // happens to skip the notification.
    if (isDuplicateKey(err)) return 'duplicate';
    console.error(`[push] could not claim ${eventId}:`, err);
    return 'failed';
  }

  const doFetch = deps.fetchImpl ?? fetch;
  let tickets: ExpoTicket[];
  try {
    const res = await doFetch(EXPO_PUSH_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(
        devices.map((d) => ({
          to: d.token,
          title: message.title,
          body: message.body,
          ...(message.data ? { data: message.data } : {}),
          // A money notice should make the phone behave like it matters.
          sound: 'default',
          priority: 'high',
        })),
      ),
      // Awaited from the deposit and withdrawal paths, like Telegram: a
      // blackholed exp.host must stall a credit by seconds, not by undici's
      // multi-minute default.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`expo push: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: ExpoTicket[]; errors?: unknown };
    if (!body.data) throw new Error(`expo push: ${JSON.stringify(body.errors ?? 'no tickets')}`);
    tickets = body.data;
  } catch (err) {
    // Release the claim so a later retry can still deliver it.
    await PushSendModel.deleteOne({ _id: eventId }).catch(() => undefined);
    console.error(`[push] send failed for ${eventId}:`, err);
    return 'failed';
  }

  await pruneDeadDevices(devices, tickets);

  // Delivered; bookkeeping failing must not release the claim, or a retry
  // re-sends what the player already has. Same trade as Telegram and email:
  // better a missing timestamp than a second notification.
  try {
    await PushSendModel.updateOne({ _id: eventId }, { $set: { sentAt: new Date() } });
  } catch (err) {
    console.error(`[push] sent but could not record sentAt for ${eventId}:`, err);
  }
  return 'sent';
}

/**
 * Drop tokens Expo says are dead.
 *
 * `DeviceNotRegistered` means the app was uninstalled, or the token rotated.
 * Left alone these accumulate forever: every future notification pays to send
 * into the void, the collection grows without bound, and — the part that
 * actually bites — a real delivery failure becomes impossible to spot in a
 * sea of expected ones.
 *
 * Tickets come back positionally, one per message in the order sent, which is
 * the only thing tying a failure to a token. A mismatched length means that
 * assumption no longer holds, so nothing is deleted rather than deleting by
 * guesswork.
 */
async function pruneDeadDevices(
  devices: { token: string }[],
  tickets: ExpoTicket[],
): Promise<void> {
  if (tickets.length !== devices.length) {
    console.error(
      `[push] ${tickets.length} tickets for ${devices.length} messages — not pruning by position`,
    );
    return;
  }

  const dead = devices
    .filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered')
    .map((d) => d.token);

  for (const token of dead) {
    await forgetPushToken(token).catch((err: unknown) =>
      console.error(`[push] could not drop dead token:`, err),
    );
  }
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Turn a Telegram body into a push notification.
 *
 * Deliberately reusing that copy rather than writing a second set. Those
 * strings are English-only today — `telegram/messages.ts` says so itself — and
 * a separate push bundle would mean localising two files later instead of one.
 * Derived like this, whoever localises the Telegram copy localises push with
 * it, and the two can never drift into saying different things about the same
 * event.
 *
 * The first line is the title (it is already the bolded headline), the rest is
 * the body. Tags are stripped and the entities `esc()` introduced are put back
 * — a player should see `Tom & Jerry`, not `Tom &amp; Jerry`.
 */
export function pushFromTelegram(html: string): PushMessage {
  const plain = html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Ampersand LAST: unescaping it first would turn `&amp;lt;` into `<`.
    .replace(/&amp;/g, '&')
    .trim();

  // Regex split, so CRLF is handled too - this copy is authored on Windows.
  const [first = '', ...rest] = plain.split(/\r?\n/);
  // Joined with a space: a push body has one or two lines of room, so the
  // blank line that separates paragraphs on Telegram would waste half of it.
  const body = rest.join(' ').replace(/\s+/g, ' ').trim();
  // A one-line message becomes a title with no body, rather than the same
  // sentence printed twice.
  return { title: first, body };
}
