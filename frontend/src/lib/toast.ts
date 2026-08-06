import { toast as sonner } from 'sonner';
import { haptic } from '@/lib/telegram';

/**
 * Toasts, with haptic feedback.
 *
 * A thin wrapper over sonner rather than direct imports at the call sites, for
 * two reasons.
 *
 * Haptics: inside Telegram a toast should be felt as well as seen, and a player
 * mid-hand is looking at the table, not the top of the screen. Sonner has no
 * concept of a device buzz, so it is added once here instead of remembered at
 * every call site.
 *
 * And it is callable from outside React — the API client's 401 handler, the
 * session store, the connection watcher. Those are exactly the places that need
 * to report a failure and exactly the places a hook cannot reach.
 */

export const toast = {
  success: (message: string): void => {
    haptic('light');
    sonner.success(message);
  },
  error: (message: string): void => {
    // A heavier buzz for failure: the one case where a player who has looked
    // away should still notice something went wrong.
    haptic('heavy');
    sonner.error(message);
  },
  info: (message: string): void => {
    haptic('light');
    sonner.info(message);
  },
};
