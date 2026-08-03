import { create } from 'zustand';
import { telegramColorScheme } from '@/lib/telegram';

/**
 * Theme = 'system' (follow Telegram / OS), 'dark', or 'light'.
 * The resolved value is stamped on <html data-theme> so the token overrides in
 * index.css take effect. This is the switch the whole design system pivots on.
 */
export type ThemeMode = 'system' | 'dark' | 'light';

const STORAGE_KEY = 'fp-theme';

function resolve(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return telegramColorScheme() ?? systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

function apply(mode: ThemeMode): 'dark' | 'light' {
  const resolved = resolve(mode);
  document.documentElement.setAttribute('data-theme', resolved);
  return resolved;
}

interface ThemeState {
  mode: ThemeMode;
  resolved: 'dark' | 'light';
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const initialMode = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'system';

export const useTheme = create<ThemeState>((set, get) => ({
  mode: initialMode,
  resolved: apply(initialMode),
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    set({ mode, resolved: apply(mode) });
  },
  toggle: () => get().setMode(get().resolved === 'dark' ? 'light' : 'dark'),
}));
