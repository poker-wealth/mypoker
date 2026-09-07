/**
 * Fails if the boot screens disagree with the brand tokens.
 *
 * `frontend/src/index.css` is the single source of truth for colour. Four
 * places cannot read it and therefore duplicate it as literals:
 *
 *   frontend/index.html   <meta name="theme-color">   browser/Telegram chrome
 *   frontend/index.html   #splash { background }      the boot screen ground
 *   frontend/index.html   #splash-mark drop-shadow    the glow, from --brand
 *   mobile/app.json       expo-splash-screen bg       the native boot screen
 *   mobile/app.json       adaptiveIcon bg             the Android launcher icon
 *
 * Each is duplicated for a real reason, not laziness. The HTML splash has to
 * paint on the browser's FIRST frame — a React splash cannot remove the white
 * flash it exists to hide, and a stylesheet is a separate request that may land
 * late — so its styles are inline. `app.json` is read by the native build long
 * before any JavaScript runs.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * index.html already carried the sentence "If the brand colours change, this
 * block changes too". It was correct, prominent, and did not work: the v3
 * repalette (Sep 2026) moved --bg and --brand and left every one of these on
 * the old violet brand, so a cold start flashed the previous identity and then
 * snapped to the new one. Nothing failed — tsc, eslint, the build and 1312
 * tests were all green, because none of them compares two files.
 *
 * The audit that should have caught it grepped `frontend/src` and `mobile/src`.
 * Neither of these files is under src/.
 *
 * docs/TRAPS.md §7 is "comments that describe intentions, not code", and §26 is
 * "a token cannot be repainted alone if its siblings are hardcoded". This is
 * both. A comment asking the next person to remember is not a mechanism; this
 * is the mechanism.
 *
 * Deliberately dumb: it reads the files as text and compares strings. It does
 * not parse CSS or boot a bundler. A rename or a reformat therefore fails here,
 * which is the point — those are exactly the moments a duplicate drifts.
 *
 * Run: npm run check:splash   (also runs inside npm run build)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const repo = join(frontend, '..');

const failures = [];
const fail = (msg) => failures.push(msg);

/** The dark block only — it is the default, and the one the boot screens copy. */
function darkToken(css, name) {
  const start = css.indexOf(':root,');
  const end = css.indexOf(":root[data-theme='light']");
  if (start < 0 || end < 0) {
    fail(
      'PARSE FAILURE: could not find the dark token block in src/index.css. ' +
        'If the theme structure changed deliberately, update this script — do not delete it.',
    );
    return null;
  }
  const block = css.slice(start, end);
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!m) {
    fail(`PARSE FAILURE: --${name} is not defined in the dark block of src/index.css.`);
    return null;
  }
  return m[1].trim();
}

/** '#d9b87c' -> '217 184 124', the form a CSS rgb() uses. */
function hexToRgbTriplet(hex) {
  const h = hex.replace('#', '').trim();
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const css = readFileSync(join(frontend, 'src', 'index.css'), 'utf8');
const bg = darkToken(css, 'bg');
const brand = darkToken(css, 'brand');

if (bg && brand) {
  const html = readFileSync(join(frontend, 'index.html'), 'utf8');

  const theme = /<meta name="theme-color" content="([^"]+)"/.exec(html);
  if (!theme) fail('PARSE FAILURE: no <meta name="theme-color"> in index.html.');
  else if (theme[1].toLowerCase() !== bg.toLowerCase())
    fail(`index.html theme-color is ${theme[1]}, but --bg is ${bg}.`);

  const splashBg = /#splash\s*\{[^}]*background:\s*([^;]+);/.exec(html);
  if (!splashBg) fail('PARSE FAILURE: no `background:` inside the #splash rule in index.html.');
  else if (splashBg[1].trim().toLowerCase() !== bg.toLowerCase())
    fail(`index.html #splash background is ${splashBg[1].trim()}, but --bg is ${bg}.`);

  const triplet = hexToRgbTriplet(brand);
  const glow = /#splash-mark\s*\{[^}]*drop-shadow\(([^)]*\))?[^;]*;/.exec(html);
  if (!glow) {
    fail('PARSE FAILURE: no drop-shadow inside the #splash-mark rule in index.html.');
  } else if (triplet && !glow[0].includes(triplet)) {
    fail(
      `index.html #splash-mark glow does not use --brand (${brand} = "rgb(${triplet} / …)"). ` +
        'The mark glows in the old brand colour.',
    );
  }

  // mobile/ is a sibling package. Absent in a frontend-only checkout, which is
  // a skip rather than a failure — a check that fails for being unable to look
  // teaches people to ignore it (TRAPS §25).
  const appJsonPath = join(repo, 'mobile', 'app.json');
  if (!existsSync(appJsonPath)) {
    console.log('  check:splash — mobile/app.json not present, skipping the native half.');
  } else {
    const app = JSON.parse(readFileSync(appJsonPath, 'utf8'));
    const plugins = app?.expo?.plugins ?? [];
    const splashPlugin = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen');
    const splashColor = splashPlugin?.[1]?.backgroundColor;
    if (!splashColor) fail('PARSE FAILURE: no expo-splash-screen backgroundColor in mobile/app.json.');
    else if (splashColor.toLowerCase() !== bg.toLowerCase())
      fail(`mobile/app.json splash backgroundColor is ${splashColor}, but --bg is ${bg}.`);

    const iconColor = app?.expo?.android?.adaptiveIcon?.backgroundColor;
    if (!iconColor) fail('PARSE FAILURE: no android.adaptiveIcon.backgroundColor in mobile/app.json.');
    else if (iconColor.toLowerCase() !== bg.toLowerCase())
      fail(`mobile/app.json adaptiveIcon backgroundColor is ${iconColor}, but --bg is ${bg}.`);
  }
}

if (failures.length > 0) {
  console.error('\n  BOOT SCREENS DISAGREE WITH THE BRAND TOKENS\n');
  for (const f of failures) console.error(`    - ${f}`);
  console.error(
    '\n  These files cannot read index.css, so they hold copies. Update them to match,\n' +
      '  or update this script if the structure changed on purpose.\n',
  );
  process.exit(1);
}

console.log('  check:splash — boot screens match the brand tokens.');
