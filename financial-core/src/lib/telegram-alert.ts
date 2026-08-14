import type { AlertContext, AlertHandler } from './alert';

/**
 * Deliver ops alerts to a Telegram chat (SAMUEL.md task 4).
 *
 * `alertOps` has always logged to stderr with a comment promising Telegram
 * "in a later milestone — call sites never change, only the handler does".
 * This is that handler; not one call site moves.
 *
 * Goes to an OPS CHAT, not to a player. That distinction is the whole design:
 * a circuit breaker firing is a message about the platform, and the chat id
 * comes from configuration rather than from any account. Nothing here can
 * accidentally message a player, because it never sees a playerId.
 *
 * Rate limited rather than deduped. A breaker that trips once is news; the same
 * breaker tripping four hundred times in a minute — which is exactly what a
 * real incident looks like — would flood the chat until Telegram rate-limits
 * the bot, and the messages that stop arriving are the later ones, when
 * somebody is finally watching. So identical alerts collapse into one per
 * window and say how many were suppressed.
 */

const TELEGRAM_API = 'https://api.telegram.org';

/** How long an identical alert stays suppressed. */
export const ALERT_WINDOW_MS = 60_000;

export interface TelegramAlertConfig {
  botToken: string;
  chatId: string;
}

export function telegramAlertConfig(
  env: NodeJS.ProcessEnv = process.env,
): TelegramAlertConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.OPS_TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/** Telegram's HTML mode — anything interpolated must be escaped. */
const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatAlert(message: string, context?: AlertContext, suppressed = 0): string {
  const lines = [`⚠️ <b>${esc(message)}</b>`];

  if (context && Object.keys(context).length > 0) {
    lines.push('');
    for (const [k, v] of Object.entries(context)) {
      lines.push(`${esc(k)}: <code>${esc(String(v))}</code>`);
    }
  }
  if (suppressed > 0) {
    // Said out loud. An operator seeing one message during an incident that
    // produced hundreds would badly misjudge its size.
    lines.push('', `<i>+${suppressed} more of these in the last minute</i>`);
  }
  return lines.join('\n');
}

interface WindowState {
  firstAt: number;
  suppressed: number;
}

/**
 * Build the handler. `fetchImpl` and `now` are injectable so the rate limiting
 * can be tested without waiting a minute.
 */
export function telegramAlertHandler(
  cfg: TelegramAlertConfig,
  deps: { fetchImpl?: typeof fetch; now?: () => number } = {},
): AlertHandler {
  const doFetch = deps.fetchImpl ?? fetch;
  const clock = deps.now ?? Date.now;
  const windows = new Map<string, WindowState>();

  return async (message: string, context?: AlertContext): Promise<void> => {
    const now = clock();
    const open = windows.get(message);

    if (open && now - open.firstAt < ALERT_WINDOW_MS) {
      open.suppressed += 1;
      return;
    }

    // A new window. Report how many the previous one swallowed, and sweep
    // windows that have gone quiet — without this the Map only ever grows, one
    // entry per distinct message this process has ever alerted.
    const suppressed = open?.suppressed ?? 0;
    for (const [key, w] of windows) {
      if (now - w.firstAt >= ALERT_WINDOW_MS) windows.delete(key);
    }
    windows.set(message, { firstAt: now, suppressed: 0 });

    try {
      const res = await doFetch(`${TELEGRAM_API}/bot${cfg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text: formatAlert(message, context, suppressed),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        // Callers AWAIT alerts — transfer() awaits one before throwing
        // IllegalFundFlowError — so an unresponsive api.telegram.org must not
        // hang a money path for undici's multi-minute default. Five seconds,
        // then the stderr fallback below still records the alert.
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Fall back to stderr rather than losing the alert entirely. An ops alert
      // that cannot reach Telegram must still reach the logs — this is the last
      // place a breaker's trip is recorded outside the database.
      console.error(`[OPS-ALERT] ${message}`, context ?? '', '(telegram failed:', err, ')');
    }
  };
}
