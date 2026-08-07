import { create } from 'zustand';
import { storedLanguage } from '@/i18n';

const ONBOARDED_KEY = 'mypoker.onboarded';

/**
 * First-launch sequencing.
 *
 * Two things want the screen on a first open — the language picker and the
 * welcome — and they must not race. The welcome has to come second, or a new
 * player reads it in a language they have not chosen yet, which is precisely the
 * problem the picker exists to solve.
 *
 * So the order is explicit rather than emergent: the picker sets languageChosen,
 * and only then does the welcome render.
 */
interface FirstRunState {
  languageChosen: boolean;
  onboarded: boolean;
  markLanguageChosen: () => void;
  markOnboarded: () => void;
}

const readOnboarded = (): boolean => {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    // Private browsing, or storage disabled. Treat as onboarded rather than
    // showing the welcome on every single launch.
    return true;
  }
};

export const useFirstRun = create<FirstRunState>((set) => ({
  languageChosen: storedLanguage() !== null,
  onboarded: readOnboarded(),
  markLanguageChosen: () => set({ languageChosen: true }),
  markOnboarded: () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      // Nothing to do — the flag simply won't persist, and the welcome
      // reappearing is a smaller failure than crashing the first launch.
    }
    set({ onboarded: true });
  },
}));
