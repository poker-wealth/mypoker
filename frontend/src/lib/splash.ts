/**
 * Dismisses the boot screen defined in index.html.
 *
 * The splash is plain HTML so it can paint before this bundle exists (see the
 * comment there); React's only job is to take it away once the app has actually
 * drawn something worth showing.
 */

/**
 * Long enough for the mark's coin-spin (3.4s per turn, see index.html) to read
 * as intentional — roughly two-thirds of a revolution before the fade starts.
 */
const MINIMUM_VISIBLE_MS = 2200;

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
  const wait = Math.max(0, MINIMUM_VISIBLE_MS - elapsed);

  window.setTimeout(() => {
    splash.classList.add('is-dismissed');
    // Remove rather than leave a transparent full-screen layer behind — it would
    // still be in the accessibility tree even with pointer-events off.
    window.setTimeout(() => splash.remove(), FADE_MS + 60);
  }, wait);
}
