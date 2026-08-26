/**
 * Thin, typed wrapper over the Telegram Mini App runtime (window.Telegram.WebApp).
 *
 * Everything here degrades gracefully in a plain browser (the object is absent),
 * so the app runs identically on the Netlify staging link and inside Telegram.
 * The signed `initData` string exposed here is what the backend verifies at login.
 */

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  initData: string;
  /**
   * The same payload as `initData`, pre-parsed and NOT signature-checked.
   * Safe for cosmetic decisions like which language to open in; never for
   * identity — that comes from the server verifying `initData`.
   */
  initDataUnsafe?: { user?: { language_code?: string }; start_param?: string };
  onEvent: (event: string, handler: () => void) => void;
  offEvent: (event: string, handler: () => void) => void;
  HapticFeedback?: { impactOccurred: (style: string) => void };
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg = (): TelegramWebApp | undefined => window.Telegram?.WebApp;

export const isTelegram = (): boolean => Boolean(tg()?.initData);

/** The signed launch payload the backend verifies to authenticate the player. */
export const initData = (): string => tg()?.initData ?? '';

/** Telegram's own light/dark choice, so the app can follow the client. */
export const telegramColorScheme = (): 'light' | 'dark' | null => tg()?.colorScheme ?? null;

/**
 * The player's Telegram interface language, e.g. 'en', 'zh-hans', 'ru'.
 * Read from the unsigned payload on purpose: picking a language is cosmetic, so
 * it doesn't need the round-trip that identity does.
 */
export const telegramLanguageCode = (): string | null =>
  tg()?.initDataUnsafe?.user?.language_code ?? null;

/**
 * The `start_param` a referral link launched the Mini App with (the id after
 * `?start=` in `t.me/<bot>?start=<id>`), or null outside Telegram / with none.
 *
 * Read from the unsigned payload on purpose, same as the language code above:
 * a referral link id is not identity and not money, just an attribution hint
 * that the server treats as untrusted input and validates before binding
 * anything to it. That's why it's safe to read here rather than needing the
 * signed `initData` round-trip.
 */
export const telegramStartParam = (): string | null =>
  tg()?.initDataUnsafe?.start_param ?? null;

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  tg()?.HapticFeedback?.impactOccurred(style);
}

/** Call once at startup: tell Telegram we're ready and take the full viewport. */
export function initTelegram(): void {
  const app = tg();
  if (!app) return;
  app.ready();
  app.expand();
}
