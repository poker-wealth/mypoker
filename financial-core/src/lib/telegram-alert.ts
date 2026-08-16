import { setAlertHandler, type AlertHandler } from './alert';

/**
 * Telegram delivery for ops alerts — circuit-breaker trips (CB4/CB5/CB6 are live today) and
 * illegal-flow alarms. This is the production handler behind `alertOps()`; the call sites in
 * breakers.ts / transfer.ts never change, only the handler installed here does.
 *
 * Delivery is best-effort and NEVER throws: an alert channel that is down must not turn a breaker
 * trip into an unhandled rejection inside a money path. Every failure falls back to stderr, so the
 * signal is degraded but never wholly lost. A hung Telegram is bounded by an abort timeout so it
 * can never block the caller (a breaker awaits alertOps()).
 */

export interface TelegramAlertConfig {
  botToken: string;
  chatId: string;
  /** Abort the send after this many ms so a hung Telegram never stalls a breaker. */
  timeoutMs?: number;
}

export function telegramAlertHandler(cfg: TelegramAlertConfig): AlertHandler {
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  const timeoutMs = cfg.timeoutMs ?? 5_000;

  return async (message, context): Promise<void> => {
    const hasContext = context !== undefined && Object.keys(context).length > 0;
    const text = hasContext ? `${message}\n\n${safeJson(context)}` : message;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.chatId, text, disable_web_page_preview: true }),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.error(`[OPS-ALERT] telegram send failed (${res.status}); alert was:`, message, context ?? '');
      }
    } catch (err) {
      console.error('[OPS-ALERT] telegram send errored; alert was:', message, context ?? '', err);
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Install Telegram delivery when TG_BOT_TOKEN + TG_OPS_CHAT_ID are both set; otherwise leave the
 * stderr default in place (dev, and any deploy that has not provisioned the bot yet). Returns
 * whether it was installed, so startup can log which channel is live.
 */
export function installTelegramAlertsFromEnv(): boolean {
  const botToken = process.env.TG_BOT_TOKEN?.trim();
  const chatId = process.env.TG_OPS_CHAT_ID?.trim();
  if (!botToken || !chatId) return false;
  setAlertHandler(telegramAlertHandler({ botToken, chatId }));
  return true;
}

function safeJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return '"<unserializable context>"';
  }
}
