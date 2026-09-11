import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

// The Mini App's translations, shared rather than copied — see metro.config.js.
// One set of files, two apps; a key added on either side exists for both.
import en from '../../frontend/src/i18n/locales/en.json';
import zh from '../../frontend/src/i18n/locales/zh.json';
import ja from '../../frontend/src/i18n/locales/ja.json';
import ko from '../../frontend/src/i18n/locales/ko.json';
import th from '../../frontend/src/i18n/locales/th.json';
import vi from '../../frontend/src/i18n/locales/vi.json';
import hi from '../../frontend/src/i18n/locales/hi.json';
import id from '../../frontend/src/i18n/locales/id.json';

/**
 * Translations for the native app.
 *
 * `en` is the fallback, so a key that somehow slips through arrives in English
 * rather than as a raw `account.statHands` on someone's screen — the failure
 * mode this project has shipped more than once.
 *
 * The device language is read once at startup. Switching languages inside the
 * app is a Settings feature and belongs with that screen, not here.
 */
export const SUPPORTED = ['en', 'zh', 'ja', 'ko', 'th', 'vi', 'hi', 'id'] as const;
export type Supported = (typeof SUPPORTED)[number];

/**
 * The language the app opens in: 中文.
 *
 * Owner directive (11 Sep 2026): "By default it should be in chinese... they
 * will struggle to find themselves to settings and change the language." The
 * audience is Chinese-speaking, and someone who opens the app in a language
 * they cannot read has to navigate Settings — in that language — to fix it.
 *
 * The DEVICE language is deliberately no longer consulted. It used to be, which
 * is why an English-language handset opened in English. A player's explicit
 * pick in Settings still wins and is still remembered (that is applied from the
 * account's stored setting, not here); this sets the starting point only.
 *
 * Matches the Mini App, which made the same change at the same time —
 * `frontend/src/i18n/index.ts`. Two clients, one answer.
 */
export const DEFAULT_LANGUAGE: Supported = 'zh';

/**
 * The picker's list and its order — 中文 first, matching
 * `frontend/src/i18n/languages.ts`. Labels are each language's own endonym,
 * never translated: someone looking for their language scans for the word they
 * recognise, and "Japanese" is no use to a person who reads only 日本語.
 */
export const LANGUAGES: readonly { code: Supported; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'th', label: 'ไทย' },
];

/** Switch language now. Persisting the choice is the caller's job (settings). */
export function setLanguage(code: string): void {
  if (!(SUPPORTED as readonly string[]).includes(code)) return;
  void i18n.changeLanguage(code);
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    ja: { translation: ja },
    ko: { translation: ko },
    th: { translation: th },
    vi: { translation: vi },
    hi: { translation: hi },
    id: { translation: id },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false }, // React Native escapes for us
  returnNull: false,
});

export default i18n;
