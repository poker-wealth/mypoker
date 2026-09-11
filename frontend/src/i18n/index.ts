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
 * The app opens in 中文 unless the player has explicitly chosen otherwise:
 *
 *   1. what the player explicitly picked (persisted)
 *   2. 中文
 *
 * Owner directive (11 Sep 2026): "By default it should be in chinese... they
 * will struggle to find themselves to settings and change the language." This
 * REVERSES the Aug 2026 "follow the phone's language" rule, which had in turn
 * reversed an earlier 中文 default — so the history here is a genuine back and
 * forth, not a drift. The phone tag is no longer consulted at all: it is a
 * guess about a person, and for this audience it was usually the wrong one.
 *
 * 中文 is also the i18next fallback below, so a key missing from a locale still
 * renders in Chinese rather than raw.
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

/**
 * The language the app opens in.
 *
 * 中文 UNLESS the player has explicitly chosen otherwise. Owner's call, and
 * the reasoning is his: the audience is Chinese-speaking, and someone who
 * opens the app in a language they cannot read has to find their way into
 * Settings — in that language — to fix it. Defaulting to the audience's
 * language means almost nobody ever needs the picker.
 *
 * The phone/browser language is DELIBERATELY not consulted. It used to come
 * first, which is why an English-language handset opened in English however
 * the fallback was set. A device tag is a guess about a person; for this
 * product it was the wrong guess most of the time.
 *
 * An explicit pick still wins and is remembered — the picker in Settings
 * stays, so anyone who wants English can have it and keep it. This changes
 * the DEFAULT, not the choice.
 */
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
