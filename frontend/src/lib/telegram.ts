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
