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
  { code: 'en', label: 'English', matches: ['en'] },
  // zh-Hant (Taiwan / Hong Kong / Macau) deliberately falls through to English
  // rather than being served Simplified — they are different written languages,
  // and guessing wrong reads worse than not guessing.
  { code: 'zh', label: '中文', matches: ['zh', 'zh-hans', 'zh-cn', 'zh-sg'] },
  { code: 'ja', label: '日本語', matches: ['ja'] },
  { code: 'ko', label: '한국어', matches: ['ko'] },
  { code: 'hi', label: 'हिन्दी', matches: ['hi'] },
  { code: 'vi', label: 'Tiếng Việt', matches: ['vi'] },
  { code: 'id', label: 'Bahasa Indonesia', matches: ['id', 'in', 'ms'] },
  { code: 'th', label: 'ไทย', matches: ['th'] },
];

export const DEFAULT_LANGUAGE = 'en';

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
