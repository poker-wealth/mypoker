import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { telegramLanguageCode } from '@/lib/telegram';
import { LANGUAGES, DEFAULT_LANGUAGE, resolveLanguage } from './languages';
import en from './locales/en.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import hi from './locales/hi.json';
import vi from './locales/vi.json';
import id from './locales/id.json';
import th from './locales/th.json';

/**
 * Translation setup.
 *
 * Locales are imported rather than fetched at runtime: there are two of them,
 * they're a few KB, and a Mini App opening on a phone shouldn't wait on a second
 * network round-trip to render its first screen in the right language.
 *
 * Language is chosen in this order:
 *   1. what the player explicitly picked (persisted)
 *   2. their Telegram interface language
 *   3. the browser's language
 *   4. English
 *
 * Only step 1 is sticky. If the player has never chosen, the app keeps following
 * Telegram — so someone who switches Telegram to Chinese sees MYPOKER in Chinese
 * without hunting for a setting.
 */

const STORAGE_KEY = 'fp-lang';

export function storedLanguage(): string | null {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved && LANGUAGES.some((l) => l.code === saved) ? saved : null;
}

function detectLanguage(): string {
  return (
    storedLanguage() ??
    resolveLanguage(telegramLanguageCode()) ??
    resolveLanguage(navigator.language) ??
    DEFAULT_LANGUAGE
  );
}

/** Change language and remember the choice. */
export function setLanguage(code: string): void {
  localStorage.setItem(STORAGE_KEY, code);
  void i18n.changeLanguage(code);
  document.documentElement.lang = code;
}

/** Forget the explicit choice and follow Telegram again. */
export function clearLanguagePreference(): void {
  localStorage.removeItem(STORAGE_KEY);
  const code = detectLanguage();
  void i18n.changeLanguage(code);
  document.documentElement.lang = code;
}

const initial = detectLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    ja: { translation: ja },
    ko: { translation: ko },
    hi: { translation: hi },
    vi: { translation: vi },
    id: { translation: id },
    th: { translation: th },
  },
  lng: initial,
  fallbackLng: DEFAULT_LANGUAGE,
  // React escapes for us; letting i18next escape as well double-encodes
  // apostrophes and quotes, which this copy is full of.
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = initial;

export default i18n;
