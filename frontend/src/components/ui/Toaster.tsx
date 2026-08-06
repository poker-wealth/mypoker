import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/store/theme';

/**
 * The toast stack. Mounted once, at the app root.
 *
 * Sits at the TOP of the screen rather than the bottom. The bottom is occupied
 * by the tab bar on every tab screen and by the action bar at a table — a toast
 * there would either cover the fold/call buttons or be covered by them, and the
 * one moment you most need to read a toast is mid-hand.
 *
 * Styled through sonner's CSS variables rather than by overriding its classes,
 * so the app's own tokens drive it and a light/dark switch needs no work here.
 * `richColors` is deliberately off: it ships its own green and red, which would
 * sit next to --success and --danger without matching them.
 */
export function Toaster() {
  const { resolved } = useTheme();

  return (
    <Sonner
      position="top-center"
      theme={resolved}
      // Above the app and the connection banner, below the first-run overlays —
      // there is nothing useful to say while someone is still choosing a
      // language.
      className="z-[150]"
      toastOptions={{
        style: {
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
        },
      }}
      // Long enough to read a sign-in confirmation in a second language, short
      // enough not to linger over the header.
      duration={3200}
      // Mobile viewport: more than a couple of stacked toasts covers the screen.
      visibleToasts={3}
      closeButton
    />
  );
}
