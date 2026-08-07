import { useEffect, useRef } from 'react';
import type { TelegramWidgetUser } from '@/api/auth';

/**
 * Telegram's official Login Widget — the sign-in path for a plain browser,
 * where there is no Mini App `initData` to verify.
 *
 * The widget is an iframe Telegram renders when its script tag is inserted; the
 * button, the confirmation flow and the popup are all theirs. We only receive
 * the signed payload in a callback and pass it up — verification happens on the
 * gateway (/auth/telegram-widget), never here.
 *
 * Telegram calls a GLOBAL function named in `data-onauth`, so one is installed
 * on window for the widget's lifetime. Only one widget is ever mounted (the
 * Profile sign-in card), so a single fixed name is fine.
 *
 * Note for testing: Telegram only serves the widget to domains registered with
 * the bot via BotFather's /setdomain — on an unregistered origin (localhost
 * included) the iframe renders nothing, which is Telegram's behaviour, not a bug
 * here.
 */

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramWidgetUser) => void;
  }
}

export function TelegramLoginButton({
  botName,
  onAuth,
}: {
  /** Bot username without the @. */
  botName: string;
  onAuth: (user: TelegramWidgetUser) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // The widget mounts once per bot name; the latest onAuth is read through a ref
  // so a re-render with a new callback doesn't tear the iframe down.
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !botName) return;

    window.onTelegramAuth = (user) => onAuthRef.current(user);

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botName);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    container.appendChild(script);

    return () => {
      container.replaceChildren();
      delete window.onTelegramAuth;
    };
  }, [botName]);

  return <div ref={containerRef} className="flex min-h-10 justify-center" />;
}
