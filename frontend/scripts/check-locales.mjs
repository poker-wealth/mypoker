/**
 * Fails the build if the locale files have drifted apart.
 *
 * A missing key doesn't crash — i18next quietly falls back to English — so a
 * half-translated screen ships looking fine to whoever wrote it and broken to
 * everyone else. This turns that into a build error.
 *
 * Also catches interpolation mismatches: if en has {{amount}} and zh doesn't,
 * the number silently vanishes from the translated string.
 *
 * And catches values that were never translated at all: the key exists, the
 * placeholders match, but the string is byte-identical to English. Neither of
 * the checks above can see that — it's exactly how 17 wallet keys, including
 * the deposit warning that "other tokens or networks will be lost", shipped
 * as English in all seven non-English locales. A funds-loss warning that
 * didn't warn.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const REFERENCE = 'en';

/**
 * Locales written in a non-Latin script. An English-identical value here is
 * far more likely to be a genuine miss than in a Latin-script locale — there
 * is no everyday reason for a Chinese, Japanese, Korean, Thai, or Hindi
 * sentence to come out byte-for-byte as English, whereas Vietnamese and
 * Indonesian legitimately keep plenty of Latin-spelled loanwords (poker
 * terms, brand names, proper nouns). So identical values here are a hard
 * failure; in Latin-script locales they're a warning — see below.
 */
const NON_LATIN_LOCALES = new Set(['zh', 'ja', 'ko', 'th', 'hi']);

/**
 * Keys where an English-identical value is a deliberate, verified choice —
 * not a missed translation. Every entry below was checked against its
 * sibling locales before being added: if this key's value differs from
 * English in every OTHER locale (including non-Latin ones, which transliterate
 * rather than translate proper nouns), that's strong evidence it's a real
 * loanword/proper-noun choice here rather than copy-pasted English.
 *
 * `locales` restricts the allowance to specific locale codes; omit it to
 * allow everywhere (used only for account.vip, which is just a brand name
 * plus a placeholder in every locale).
 *
 * Keep reasons one line. If you can't write a one-line reason that would
 * survive someone asking "are you sure", it doesn't belong here — let it
 * surface as a warning (or a failure, in a non-Latin locale) instead.
 */
const ALLOWED_IDENTICAL = {
  'account.vip': {
    reason: 'VIP is a universal loanword; the value is just the brand term plus a placeholder — nothing else to translate.',
  },
  'account.id': {
    locales: ['id', 'ko', 'vi'],
    reason: '"ID" is a globally recognized technical abbreviation kept in Latin script (hi/th instead transliterate it — a stylistic choice, not evidence this one is wrong).',
  },
  'auth.email': {
    locales: ['id', 'vi'],
    reason: '"Email" is used untranslated in casual Indonesian/Vietnamese tech registers; both Latin-script locales independently made the same choice.',
  },
  'table.call': {
    locales: ['id'],
    reason: '"Call" used as an English poker loanword in Indonesian.',
  },
  'table.pot': {
    locales: ['id', 'vi'],
    reason: '"Pot" is a poker loanword kept in Indonesian/Vietnamese.',
  },
  'table.halfPot': {
    locales: ['id', 'vi'],
    reason: 'Built on the "Pot" loanword — see table.pot.',
  },
  'table.threeQuarterPot': {
    locales: ['id', 'vi'],
    reason: 'Built on the "Pot" loanword — see table.pot.',
  },
  'games.filter.poker': {
    locales: ['id', 'vi'],
    reason: '"Poker" is the game genre\'s own name, kept untranslated as a category label.',
  },
  'games.filter.arcade': {
    locales: ['vi'],
    reason: '"Arcade" kept untranslated as a category label (cf. games.filter.poker; id localizes to "Arkade").',
  },
  'jackpot.tier.MINI': {
    locales: ['id', 'vi'],
    reason: 'Jackpot tier badge name kept as an English loanword; every non-Latin locale localizes it into its own script instead.',
  },
  'jackpot.tier.MINOR': { locales: ['id', 'vi'], reason: 'See jackpot.tier.MINI.' },
  'jackpot.tier.MAJOR': { locales: ['id', 'vi'], reason: 'See jackpot.tier.MINI.' },
  'jackpot.tier.GRAND': { locales: ['id', 'vi'], reason: 'See jackpot.tier.MINI.' },
  'lobby.tab.dezhou': {
    locales: ['id', 'vi'],
    reason: 'Transliterated Chinese place/category name (pinyin for 德州); Latin-script locales keep the Latin spelling, non-Latin locales render it phonetically in their own script.',
  },
  'lobby.tab.xuzhou': {
    locales: ['id'],
    reason: 'See lobby.tab.dezhou (vi localizes this one to "Từ Châu").',
  },
  'gameNames.texas': { locales: ['id', 'vi'], reason: '"Texas Hold’em" is a proper noun kept in Latin spelling.' },
  'gameNames.setteMezzo': { locales: ['id', 'vi'], reason: 'Italian proper noun kept in Latin spelling.' },
  'gameNames.short-deck': { locales: ['id', 'vi'], reason: 'Poker variant name kept in Latin spelling.' },
  'gameNames.omaha': { locales: ['id', 'vi'], reason: 'Proper noun (city name) kept in Latin spelling.' },
  'gameNames.san-zhang': { locales: ['id', 'vi'], reason: 'Transliterated Chinese game name (pinyin) kept in Latin spelling.' },
  'gameNames.baccarat': { locales: ['vi'], reason: 'French-origin proper noun kept in Latin spelling (id localizes to "Bakarat").' },
  'gameNames.blackjack': { locales: ['id'], reason: 'Proper noun kept in Latin spelling (vi localizes to "Xì Dách").' },
  'gameNames.fishingWar': { locales: ['id'], reason: 'Game title kept as a brand name (vi localizes to "Bắn Cá").' },
  'gameNames.niu-niu': { locales: ['id'], reason: 'Transliterated Chinese game name (pinyin) kept in Latin spelling (vi localizes to "Ngưu Ngưu").' },
  'gameNames.dou-di-zhu': { locales: ['id'], reason: 'Transliterated Chinese game name (pinyin) kept in Latin spelling (vi localizes to "Đấu Địa Chủ").' },
};

/** Flatten nested JSON to dotted paths → string value. */
function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out);
    else out[path] = String(value);
  }
  return out;
}

const placeholders = (s) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort().join(',');

/** True if a string is nothing but interpolation placeholders (and whitespace/punctuation) — no actual words to translate, so a match across locales is meaningless. */
const isPlaceholderOnly = (s) => s.replace(/\{\{\s*\w+\s*\}\}/g, '').trim() === '';

function isAllowedIdentical(key, code) {
  const rule = ALLOWED_IDENTICAL[key];
  if (!rule) return false;
  return !rule.locales || rule.locales.includes(code);
}

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
const locales = Object.fromEntries(
  files.map((f) => [f.replace('.json', ''), flatten(JSON.parse(readFileSync(join(LOCALES_DIR, f), 'utf8')))]),
);

const reference = locales[REFERENCE];
if (!reference) {
  console.error(`\n  check-locales: no ${REFERENCE}.json to compare against\n`);
  process.exit(1);
}

const problems = [];
const identicalWarnings = [];

for (const [code, entries] of Object.entries(locales)) {
  if (code === REFERENCE) continue;

  for (const key of Object.keys(reference)) {
    if (!(key in entries)) {
      problems.push(`${code}: missing  ${key}`);
      continue;
    }
    if (placeholders(reference[key]) !== placeholders(entries[key])) {
      problems.push(
        `${code}: placeholders differ on  ${key}  ` +
          `(${REFERENCE}: ${placeholders(reference[key]) || 'none'} / ${code}: ${placeholders(entries[key]) || 'none'})`,
      );
      continue;
    }

    // Untranslated-value check: the value made it through as raw English.
    if (entries[key] === reference[key] && !isPlaceholderOnly(reference[key])) {
      if (isAllowedIdentical(key, code)) continue;
      const line = `${code}: identical to ${REFERENCE}  ${key}  = ${JSON.stringify(entries[key])}`;
      if (NON_LATIN_LOCALES.has(code)) problems.push(line);
      else identicalWarnings.push(line);
    }
  }
  for (const key of Object.keys(entries)) {
    if (!(key in reference)) problems.push(`${code}: orphan   ${key}  (not in ${REFERENCE}.json)`);
  }
}

if (identicalWarnings.length) {
  console.warn(`\n  ${identicalWarnings.length} value(s) identical to English in Latin-script locales (not failing the build — review for missed translations):\n`);
  for (const w of identicalWarnings) console.warn(`    ${w}`);
  console.warn('');
}

if (problems.length) {
  console.error(`\n  LOCALES OUT OF SYNC — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  process.exit(1);
}

const count = Object.keys(reference).length;
console.log(`  locales in sync — ${count} keys × ${files.length} languages`);
