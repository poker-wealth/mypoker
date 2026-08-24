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

/** The device's language if we speak it, otherwise English. */
export function deviceLanguage(): Supported {
  const tag = getLocales()[0]?.languageCode ?? 'en';
  return (SUPPORTED as readonly string[]).includes(tag) ? (tag as Supported) : 'en';
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
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React Native escapes for us
  returnNull: false,
});

export default i18n;
