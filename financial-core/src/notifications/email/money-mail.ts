import { notify, GOVERNED_BY } from '../notification-store';
import { sendEmail } from './send-email';
import { depositReceived, withdrawalRequested, withdrawalSent } from './templates';
import { sendTelegram } from '../telegram/send-telegram';
import * as tg from '../telegram/messages';
import { getSettings } from '../../settings/player-settings';
import { resolveLocale, DEFAULT_LOCALE, type Locale } from './messages';

/**
 * The money events a player is told about, in one place.
 *
 * SAMUEL.md: "Hook into the same place the in-app notification already fires —
 * don't build a parallel event system." So this is not a second event bus. It
 * is one call that raises the in-app notification and the email from the same
 * event id, and it is the only thing the deposit and withdrawal paths call.
 * Two separate call sites would drift the first time someone added an event to
 * one and forgot the other.
 *
 * The in-app notification did not previously fire for deposits or withdrawals
 * at all — notify() had a single caller, the internal endpoint the gateway
 * posts to for jackpot wins — so "the place it already fires" had to be made
 * to exist before email could ride it.
 *
 * NOTHING HERE MAY FAIL THE MONEY PATH. Every call is wrapped: a mail server
 * refusing connections, a settings lookup timing out, must not roll back a
 * credit that already happened. The money is the product; the receipt is a
 * courtesy.
 */

/**
 * Where a player's email address comes from.
 *
 * Resolved by asking the gateway, per event, storing nothing — see
 * `gateway-recipient.ts` for why that beats the alternatives. Installed at
 * startup in src/index.ts when GATEWAY_URL is set; absent, it stays null and
 * every send degrades to 'no_recipient', which is a normal outcome.
 *
 * An earlier version of this comment claimed financial-core "never calls
 * outward, per docs/handoff/02-architecture.md". Both halves were wrong: the
 * architecture doc draws the arrow gateway → financial-core but does not
 * forbid the reverse, and this service already calls out to TronGrid to watch
 * for deposits. The seam was left unwired longer than it needed to be on the
 * strength of a rule that was never written down.
 *
 * Only web sign-ups reach it at all. A Telegram player's chat id is inside
 * their playerId, so they are notified with no lookup — see
 * notifications/telegram/.
 */
export type RecipientResolver = (playerId: string) => Promise<string | null>;

let resolveRecipient: RecipientResolver = () => Promise.resolve(null);

/** Install the address lookup once, at startup, when it has been decided. */
export function setRecipientResolver(resolver: RecipientResolver): void {
  resolveRecipient = resolver;
}

/**
 * One settings read, answering both questions an announcement has: may we send
 * this, and in what language.
 *
 * Read together on purpose. They come from the same document, and splitting
 * them into two lookups would double the round trips on the money path to learn
 * two fields of one row.
 *
 * FAILS OPEN. A settings read that throws — Mongo blinking, a timeout — must
 * not silence a money receipt. The cost of one message someone had muted is an
 * annoyance; the cost of a missing deposit receipt is a player who believes
 * their funds have vanished. Silence is the expensive direction, so an
 * unreadable preference is treated as "not muted, in English" rather than as
 * consent to say nothing.
 */
async function preferences(
  playerId: string,
  kind: 'DEPOSIT' | 'SYSTEM',
): Promise<{ allowed: boolean; locale: Locale }> {
  const toggle = GOVERNED_BY[kind];
  try {
    const settings = await getSettings(playerId);
    return {
      // SYSTEM — a withdrawal notice is how someone learns about a withdrawal
      // they did not make. No toggle governs it and none ever should.
      allowed: toggle === null ? true : settings[toggle],
      locale: resolveLocale(settings.language),
    };
  } catch (err) {
    console.error(`[money-mail] settings unreadable for ${playerId}, announcing anyway:`, err);
    return { allowed: true, locale: DEFAULT_LOCALE };
  }
}

async function announce(input: {
  playerId: string;
  eventId: string;
  kind: 'DEPOSIT' | 'SYSTEM';
  titleKey: string;
  params: Record<string, string | number>;
  /**
   * Built from the player's locale, so it cannot be constructed before we know
   * what that is. A factory rather than a value for exactly that reason — and
   * it is still called inside this function, which the callers wrap, so a throw
   * here remains a log line rather than a rejected credit.
   */
  template: (locale: Locale) => Parameters<typeof sendEmail>[1];
  /** The Telegram body for this event. */
  telegram: string;
}): Promise<void> {
  // One preference check covering every channel. notify() checks again for its
  // own sake — it has callers that never come through here — but a player who
  // muted deposits must not be reached on Telegram or by email either, and
  // that is not a decision notify() is in a position to make.
  const { allowed, locale } = await preferences(input.playerId, input.kind);
  if (!allowed) return;

  try {
    await notify({
      playerId: input.playerId,
      kind: input.kind,
      titleKey: input.titleKey,
      eventId: input.eventId,
      params: input.params,
    });
  } catch (err) {
    console.error(`[money-mail] in-app notification failed for ${input.eventId}:`, err);
  }

  // Telegram FIRST, and it is the channel the spec actually names. It also
  // needs no address: a Telegram player's id IS their chat id, so this reaches
  // the majority of players with nothing to look up.
  try {
    await sendTelegram(input.playerId, input.telegram, input.eventId);
  } catch (err) {
    console.error(`[money-mail] telegram failed for ${input.eventId}:`, err);
  }

  // Email is the fallback for web sign-ups, who have no Telegram to reach.
  // Both are attempted: sendTelegram returns not_telegram for a web account and
  // sendEmail returns no_recipient for a Telegram one, so each player gets
  // exactly the channel that can reach them without either needing to know
  // about the other.
  try {
    const to = await resolveRecipient(input.playerId);
    // Same event id as the notification: one event, one message per channel,
    // however many times the credit or the transition is retried.
    await sendEmail(to, input.template(locale), input.eventId);
  } catch (err) {
    console.error(`[money-mail] email failed for ${input.eventId}:`, err);
  }
}

/** Money in — called after the credit is written, never before. */
export async function announceDeposit(input: {
  playerId: string;
  /** Ledger decimal string. */
  amount: string;
  txHash: string;
  network: string;
  at?: Date;
}): Promise<void> {
  // The whole body is guarded, TEMPLATE CONSTRUCTION INCLUDED. The templates
  // are built while announce()'s arguments are evaluated — before any of its
  // internal try/catches exist — and the callers await these functions from
  // directly inside the credit and withdrawal paths, after the money has
  // committed. A throw here (reachable only via a type violation, but this is
  // the money path we are talking about) must end in a log line, not in a
  // rejected credit.
  try {
    const at = input.at ?? new Date();
    await announce({
      playerId: input.playerId,
      // The tx hash is already the credit's idempotency key, so the receipt is
      // idempotent on exactly what the money was idempotent on.
      eventId: `deposit:${input.txHash}`,
      kind: 'DEPOSIT',
      titleKey: 'notifications.depositCredited',
      params: { amount: input.amount },
      template: (locale) =>
        depositReceived({
          amount: input.amount,
          txHash: input.txHash,
          network: input.network,
          at,
          locale,
        }),
      telegram: tg.depositReceived({ amount: input.amount, txHash: input.txHash }),
    });
  } catch (err) {
    console.error(`[money-mail] deposit announce failed for ${input.txHash}:`, err);
  }
}

/** Money out, step one — the receipt for a request. */
export async function announceWithdrawalRequested(input: {
  playerId: string;
  withdrawalId: string;
  amount: string;
  address: string;
  at?: Date;
}): Promise<void> {
  // Guarded in full — see announceDeposit for why the template construction
  // must sit inside the try.
  try {
    await announce({
      playerId: input.playerId,
      eventId: `withdrawal:${input.withdrawalId}:requested`,
      // SYSTEM, not DEPOSIT: money leaving an account is a security notice, and
      // §notification toggles make SYSTEM unsuppressible. A player who has
      // muted deposit alerts must still be told that funds are being sent out —
      // that message is how they find out about a withdrawal they did not make.
      kind: 'SYSTEM',
      titleKey: 'notifications.withdrawalRequested',
      params: { amount: input.amount },
      template: (locale) =>
        withdrawalRequested({
          amount: input.amount,
          address: input.address,
          at: input.at ?? new Date(),
          locale,
        }),
      telegram: tg.withdrawalRequested({ amount: input.amount, address: input.address }),
    });
  } catch (err) {
    console.error(`[money-mail] request announce failed for ${input.withdrawalId}:`, err);
  }
}

/** Money out, step two — it has been broadcast. */
export async function announceWithdrawalSent(input: {
  playerId: string;
  withdrawalId: string;
  amount: string;
  address: string;
  txHash: string;
  network: string;
  at?: Date;
}): Promise<void> {
  // Guarded in full — see announceDeposit for why the template construction
  // must sit inside the try.
  try {
    await announce({
      playerId: input.playerId,
      eventId: `withdrawal:${input.withdrawalId}:sent`,
      kind: 'SYSTEM',
      titleKey: 'notifications.withdrawalSent',
      params: { amount: input.amount },
      template: (locale) =>
        withdrawalSent({
          amount: input.amount,
          address: input.address,
          txHash: input.txHash,
          network: input.network,
          at: input.at ?? new Date(),
          locale,
        }),
      telegram: tg.withdrawalSent({ amount: input.amount, txHash: input.txHash }),
    });
  } catch (err) {
    console.error(`[money-mail] sent announce failed for ${input.withdrawalId}:`, err);
  }
}
