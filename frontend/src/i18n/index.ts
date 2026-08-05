import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES, DEFAULT_LANGUAGE } from './languages';
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
 * MYPOKER is a Chinese-language product with translations, so **everyone opens
 * in 中文** — including a player whose Telegram is set to English or Japanese.
 * The only thing that changes it is the player picking a language themselves,
 * which is then remembered.
 *
 *   1. what the player explicitly picked (persisted)
 *   2. 中文
 *
 * Telegram and browser language are deliberately NOT consulted. That is the
 * client's decision, not an oversight — `resolveLanguage()` and
 * `telegramLanguageCode()` still exist and are what you would wire back in to
 * restore auto-detection.
 *
 * Because a player can land on a screen they cannot read, the picker in My
 * Account labels every option in its own language, and sits at a fixed position
 * in the menu so it can be found by shape rather than by reading.
 */

const STORAGE_KEY = 'fp-lang';

export function storedLanguage(): string | null {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved && LANGUAGES.some((l) => l.code === saved) ? saved : null;
}

function detectLanguage(): string {
  return storedLanguage() ?? DEFAULT_LANGUAGE;
}

/** Change language and remember the choice. */
export function setLanguage(code: string): void {
  localStorage.setItem(STORAGE_KEY, code);
  void i18n.changeLanguage(code);
  document.documentElement.lang = code;
}

/** Drop the saved choice and go back to 中文. */
export function resetLanguage(): void {
  localStorage.removeItem(STORAGE_KEY);
  void i18n.changeLanguage(DEFAULT_LANGUAGE);
  document.documentElement.lang = DEFAULT_LANGUAGE;
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
