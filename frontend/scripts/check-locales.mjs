/**
 * Fails the build if the locale files have drifted apart.
 *
 * A missing key doesn't crash — i18next quietly falls back to English — so a
 * half-translated screen ships looking fine to whoever wrote it and broken to
 * everyone else. This turns that into a build error.
 *
 * Also catches interpolation mismatches: if en has {{amount}} and zh doesn't,
 * the number silently vanishes from the translated string.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const REFERENCE = 'en';

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

for (const [code, entries] of Object.entries(locales)) {
  if (code === REFERENCE) continue;

  for (const key of Object.keys(reference)) {
    if (!(key in entries)) problems.push(`${code}: missing  ${key}`);
    else if (placeholders(reference[key]) !== placeholders(entries[key])) {
      problems.push(
        `${code}: placeholders differ on  ${key}  ` +
          `(${REFERENCE}: ${placeholders(reference[key]) || 'none'} / ${code}: ${placeholders(entries[key]) || 'none'})`,
      );
    }
  }
  for (const key of Object.keys(entries)) {
    if (!(key in reference)) problems.push(`${code}: orphan   ${key}  (not in ${REFERENCE}.json)`);
  }
}

if (problems.length) {
  console.error(`\n  LOCALES OUT OF SYNC — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  process.exit(1);
}

const count = Object.keys(reference).length;
console.log(`  locales in sync — ${count} keys × ${files.length} languages`);
