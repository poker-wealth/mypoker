/**
 * The languages MYPOKER ships in.
 *
 * `label` is deliberately written in the language itself — someone who has
 * accidentally switched to a language they can't read still needs to find their
 * way back, and "Chinese" is no help if you only read Chinese.
 */
export interface Language {
  code: string;
  /** Endonym — the language's name in its own language. */
  label: string;
  /** Telegram / browser codes that should resolve to this language. */
  matches: string[];
}

export const LANGUAGES: Language[] = [
  // 中文 first: it is the product's primary language, and this list is the order
  // the picker renders in.
  //
  // Traditional-script tags (zh-TW / zh-HK / zh-MO / zh-Hant) resolve here too,
  // via the primary-subtag fallback in resolveLanguage. That is Simplified served
  // to a Traditional audience — imperfect, but better than English. Adding a real
  // zh-Hant locale is the proper fix; see the note on DEFAULT_LANGUAGE.
  { code: 'zh', label: '中文', matches: ['zh', 'zh-hans', 'zh-cn', 'zh-sg'] },
  { code: 'en', label: 'English', matches: ['en'] },
  { code: 'ja', label: '日本語', matches: ['ja'] },
  { code: 'ko', label: '한국어', matches: ['ko'] },
  { code: 'hi', label: 'हिन्दी', matches: ['hi'] },
  { code: 'vi', label: 'Tiếng Việt', matches: ['vi'] },
  { code: 'id', label: 'Bahasa Indonesia', matches: ['id', 'in', 'ms'] },
  { code: 'th', label: 'ไทย', matches: ['th'] },
];

/**
 * The product's primary language.
 *
 * Used when nothing else is known — no saved choice, and neither Telegram nor
 * the browser declares a language we ship. It is also i18next's fallback, so a
 * key missing from any locale renders in Chinese rather than English.
 *
 * Note this does NOT override detection: a player whose Telegram is in English
 * still gets English. It decides only what an unknown visitor sees.
 */
export const DEFAULT_LANGUAGE = 'zh';

/**
 * Map a Telegram or browser language tag onto a language we actually ship.
 *
 * Tags arrive in several shapes — 'zh', 'zh-CN', 'zh-Hans-CN' — so match on the
 * longest declared alias first, then fall back to the primary subtag. Returns
 * null rather than a default so callers can tell "no preference expressed" apart
 * from "explicitly wants English".
 */
export function resolveLanguage(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();

  const exact = LANGUAGES.find((l) => l.matches.includes(lower));
  if (exact) return exact.code;

  const primary = lower.split('-')[0] ?? '';
  const byPrimary = LANGUAGES.find((l) => l.matches.includes(primary));
  return byPrimary?.code ?? null;
}
