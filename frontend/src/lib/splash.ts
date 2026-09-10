import { isTelegram } from '@/lib/telegram';

/**
 * Dismisses the boot screen defined in index.html.
 *
 * The splash is plain HTML so it can paint before this bundle exists (see the
 * comment there); React's only job is to take it away once the app has actually
 * drawn something worth showing.
 */

/**
 * How long the boot screen is held open AFTER the app is ready to draw.
 *
 * Inside Telegram this is a launch moment: you tapped an app and it is opening,
 * and the mark's coin-spin (3.4s per turn, see index.html) needs roughly
 * two-thirds of a revolution to read as intentional rather than as a flicker.
 *
 * On the open web it is not a launch, it is a page. Someone who follows a link
 * to mypoker777.com is not opening an app and did not ask for a title card;
 * they are waiting to see whether this site is worth their time, and a 2.2s
 * interstitial in front of a marketing page reads as a slow site — which is
 * exactly how it was reported. So a browser gets only enough hold for the fade
 * to look deliberate instead of like a rendering glitch.
 *
 * This is a floor on top of however long the app actually took, not a timeout:
 * neither number delays anything that was not already ready.
 */
const HOLD_TELEGRAM_MS = 2200;
const HOLD_BROWSER_MS = 300;

/*
 * Asked at dismissal, not at module load. This module is imported by main.tsx
 * before `initTelegram()` runs, and `window.Telegram.WebApp` is populated by a
 * script tag rather than by us — reading it during module evaluation is a guard
 * running a beat early (TRAPS 14), and it would fail in the direction that
 * silently costs the Mini App its launch screen.
 */
const minimumVisibleMs = (): number => (isTelegram() ? HOLD_TELEGRAM_MS : HOLD_BROWSER_MS);

/** Matches the CSS transition on #splash. */
const FADE_MS = 320;

const startedAt = Date.now();

export function dismissSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;

  // On a warm load the app is ready in ~50ms, and a splash that appears and
  // vanishes inside a tenth of a second looks like a rendering bug. Hold it
  // just long enough to read as deliberate.
  const elapsed = Date.now() - startedAt;
  const wait = Math.max(0, minimumVisibleMs() - elapsed);

  window.setTimeout(() => {
    splash.classList.add('is-dismissed');
    // Remove rather than leave a transparent full-screen layer behind — it would
    // still be in the accessibility tree even with pointer-events off.
    window.setTimeout(() => splash.remove(), FADE_MS + 60);
  }, wait);
}
