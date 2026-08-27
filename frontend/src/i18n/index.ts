import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES, DEFAULT_LANGUAGE, resolveLanguage } from './languages';
import { telegramLanguageCode } from '../lib/telegram';
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
 * The app opens in the player's OWN language, following the phone: someone whose
 * Telegram is set to Thai lands on ไทย, a Korean phone on 한국어. An explicit
 * in-app choice still wins and is remembered, so a player who picks a language
 * keeps it regardless of what the phone says.
 *
 *   1. what the player explicitly picked (persisted)
 *   2. the phone's Telegram language   — resolveLanguage(telegramLanguageCode())
 *   3. the browser / device language   — resolveLanguage(navigator.language)
 *   4. 中文 as the final fallback
 *
 * Owner directive (Aug 2026): "follow the phone's language" — reversing the
 * earlier decision to force 中文 on everyone. 中文 stays the i18next fallback
 * below, so a key missing from a locale still renders in Chinese rather than raw.
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
