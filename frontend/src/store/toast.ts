import { create } from 'zustand';

/**
 * The app's one notification channel.
 *
 * Deliberately a store rather than a React context: money and socket code needs
 * to report failures from outside the component tree (an API rejection, a
 * dropped connection), and `toast.error(...)` works anywhere. The provider only
 * renders what the store holds.
 */

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

/** How long each tone stays up. Errors linger — they're the ones worth reading. */
const DURATION: Record<ToastTone, number> = {
  success: 2600,
  info: 3000,
  error: 4800,
};

/** Beyond this the stack covers the screen; oldest drops off. */
const MAX_VISIBLE = 3;

interface ToastState {
  toasts: Toast[];
  show: (tone: ToastTone, message: string) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;
const timers = new Map<number, number>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: (tone, message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, tone, message }].slice(-MAX_VISIBLE) }));

    timers.set(
      id,
      window.setTimeout(() => get().dismiss(id), DURATION[tone]),
    );
    return id;
  },

  dismiss: (id) => {
    const timer = timers.get(id);
    // Clear the timer as well as removing the toast — a manual dismiss otherwise
    // leaves a pending callback that fires against an id that no longer exists.
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/**
 * Fire a toast from anywhere — including outside React.
 *
 *   toast.success(t('wallet.copied'))
 *   toast.error(err.message)
 *
 * Pass translated text. This layer has no opinion about language, so callers own
 * the t() call; a raw key here would surface as a literal `wallet.copied` on
 * screen, which is the kind of thing that reaches production.
 */
export const toast = {
  success: (message: string) => useToastStore.getState().show('success', message),
  error: (message: string) => useToastStore.getState().show('error', message),
  info: (message: string) => useToastStore.getState().show('info', message),
};
