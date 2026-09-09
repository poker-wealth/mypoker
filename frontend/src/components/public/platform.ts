import { Apple, Send, Smartphone } from 'lucide-react';
import { ANDROID_APK_URL, IOS_TESTFLIGHT_URL, TELEGRAM_APP_URL } from '@/config';

/**
 * The three ways onto the platform, shared by the public pages.
 *
 * Its own module rather than a corner of `PublicLayout`: a file that exports
 * both components and plain helpers loses fast refresh, and every consumer of
 * these is a component file that edits often.
 */

export type Platform = 'telegram' | 'android' | 'ios';

export const PLATFORM_ICON = { telegram: Send, android: Smartphone, ios: Apple } as const;

/**
 * In the order the buttons and tabs show them.
 *
 * Telegram leads, and not for parity with the reference — which offers only
 * iOS and Android. It leads because it is the ONLY route that works today:
 * the Mini App is live at `t.me/<bot>`, while the APK has no host and iOS has
 * no TestFlight. Putting a working route behind two unavailable ones would
 * send every visitor to a dead end first.
 */
export const PLATFORMS: Platform[] = ['telegram', 'android', 'ios'];

/**
 * Which platform to open on — a guess, and only ever a DEFAULT. Every platform
 * stays one click away: user-agent sniffing is wrong often enough (desktop
 * users mailing themselves the link, in-app browsers, spoofed strings) that
 * hiding the others would strand the very people these pages exist for.
 */
export function guessPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'telegram';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  // Desktop, or something we do not recognise: Telegram runs in a browser, so
  // it is the one tab that can actually be used from here.
  return 'telegram';
}

/**
 * Where each button goes.
 *
 * EMPTY MEANS NOT AVAILABLE YET and the caller must say so rather than render a
 * button that goes nowhere — a dead download button on a gambling site reads as
 * a scam. Android and iOS are both unset today; Telegram is derived from
 * TELEGRAM_BOT_NAME and is the one route currently live.
 */
export function platformTargets(): Record<Platform, string> {
  return { telegram: TELEGRAM_APP_URL, android: ANDROID_APK_URL, ios: IOS_TESTFLIGHT_URL };
}
