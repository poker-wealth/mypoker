import { Linking } from 'react-native';

/**
 * The one door to a human.
 *
 * Support is the Telegram bot chat — the same bot that signs Mini App players
 * in, because that is where support actually answers. One bot, two clients,
 * one conversation.
 *
 * ── Why this is its own module ─────────────────────────────────────────────
 *
 * LoginScreen has carried this URL as a private `const` since it was written,
 * and Me had no support affordance at all. Adding a second literal next to the
 * Me screen's own button is how the two eventually disagree — the same reason
 * financial-core keeps GOVERNED_BY in one table rather than repeating
 * `notifyDeposits` beside every send. If the bot is ever renamed, it is renamed
 * here and nowhere else.
 *
 * Mirrors the web's default in frontend/src/config.ts (`TELEGRAM_BOT_NAME`).
 * Mobile has no env plumbing, so the name is literal on this side; the two are
 * kept in step by hand, like theme.ts and the web's tokens.
 */
export const SUPPORT_URL = 'https://t.me/mypoker777_bot';

/**
 * Open the support chat.
 *
 * Swallows the failure deliberately. `Linking.openURL` rejects when no app will
 * take a `t.me` link — no Telegram, and no browser willing to handle it — and
 * there is nothing useful to say at that point: the player cannot install
 * Telegram from inside a rejected promise, and a red error toast over a screen
 * they were only browsing is worse than the tap doing nothing.
 */
export function openSupport(): void {
  void Linking.openURL(SUPPORT_URL).catch(() => undefined);
}
