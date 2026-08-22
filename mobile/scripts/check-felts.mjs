/**
 * Fails if a game loses its felt.
 *
 * The Mini App's registry was lost to a merge twice. Both times the app still built, every route
 * still loaded, and every game silently rendered the poker table — nothing failed, so nobody knew
 * until someone opened baccarat and watched it deal community cards. `frontend` has
 * `registry.test.ts` for exactly this; `mobile` has no test runner, and adding one to assert a
 * nine-line map is not worth the dependency, so this reads the source instead.
 *
 * It is deliberately dumb: it does not import the registry (that would need a bundler for JSX and
 * React Native), it reads the file as text and checks each id is mapped to something. A rename
 * therefore fails here, which is the point — renaming a table id is exactly when the felt goes
 * missing.
 *
 * Run: npm run check:felts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = join(here, '..', 'src', 'components', 'games', 'registry.tsx');

/**
 * Every table id that must have a felt, and the component each one is expected to resolve to.
 *
 * This list is the assertion, not a mirror of the registry — copying whatever the registry happens
 * to say would pass no matter what got deleted. Add a game here when its felt lands.
 */
const REQUIRED = {
  texas: 'HoldemFelt',
  'texas-high': 'HoldemFelt',
  'short-deck': 'HoldemFelt',
  omaha: 'HoldemFelt',
  'niu-niu': 'NiuNiuFelt',
  baccarat: 'BaccaratFelt',
  'cowboy-beauty': 'CowboyBeautyFelt',
  'san-zhang': 'SanZhangFelt',
  'red-packet': 'RedPacketFelt',
  'dou-di-zhu': 'DouDiZhuFelt',
  lottery: 'LotteryFelt',
  slots: 'SlotsFelt',
  'texas-cowboy': 'TexasCowboyFelt',
};

const source = readFileSync(registryPath, 'utf8');

// The map body only — so a table id appearing in a comment or an import cannot satisfy the check.
const mapMatch = source.match(/GAME_FELTS:\s*Record<string,\s*FeltComponent>\s*=\s*\{([\s\S]*?)\n\};/);
if (!mapMatch) {
  console.error('check:felts — could not find the GAME_FELTS map in registry.tsx.');
  console.error('The map was renamed, reshaped, or removed. That is the failure this guards.');
  process.exit(1);
}
const body = mapMatch[1];

const problems = [];
for (const [tableId, component] of Object.entries(REQUIRED)) {
  // Keys are quoted only when they need to be, so accept both forms.
  const key = `(?:'${tableId}'|"${tableId}"|${tableId})`;
  const entry = new RegExp(`^\\s*${key}\\s*:\\s*(\\w+)\\s*,`, 'm');
  const found = body.match(entry);
  if (!found) {
    problems.push(`  ${tableId} — no entry. This game will report "no felt on mobile yet".`);
  } else if (found[1] !== component) {
    problems.push(`  ${tableId} — maps to ${found[1]}, expected ${component}.`);
  }
}

// A felt that is imported but never mapped is the same bug seen from the other side.
for (const component of new Set(Object.values(REQUIRED))) {
  if (!new RegExp(`\\b${component}\\b`).test(source)) {
    problems.push(`  ${component} — not imported into the registry at all.`);
  }
}

if (problems.length > 0) {
  console.error(`check:felts — ${problems.length} game(s) would render wrong:\n`);
  console.error(problems.join('\n'));
  console.error('\nNothing else fails when this breaks. That is why this check exists.');
  process.exit(1);
}

console.log(`check:felts — all ${Object.keys(REQUIRED).length} table ids have their felt.`);
