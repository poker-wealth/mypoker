#!/usr/bin/env node
/**
 * Fails if the native app's navigation drifts from the Mini App's.
 *
 * `mobile/` has drifted from `frontend/` repeatedly — a Wallet tab the web never had, a missing
 * Games tab, tabs in the wrong order, three whole web pages (Games, Fairness, Jackpot) with no
 * mobile screen at all, a Wallet screen a quarter the size of the web's. Every one of those was
 * reported as "every non-game screen is ported" and found later by a person, not a check. This
 * script is that check: it reads `frontend/src/router.tsx`, `frontend/src/components/BottomNav.tsx`,
 * `mobile/App.tsx` and `mobile/src/navigation.ts` as TEXT — no bundler, no parser dependency, no
 * importing either app's code — and fails the build the moment they say different things.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *
 * It proves: every web page (component) has a same-named mobile screen (component, minus the
 * `Screen` suffix) reachable somewhere in `App.tsx`; the mobile tab bar has the same pages, in the
 * same order, as the web's; and the two apps land on the same page after launch.
 *
 * It does NOT prove the mobile screen is complete, wired to real data, or visually correct — the
 * Wallet stub existed, wired to nothing much, and this exact check would have passed it, because a
 * text scan cannot tell a full port from an 85-line stub. It also cannot see anything React
 * *renders* dynamically (a component computed at runtime, a route added via `.map()`) — it only
 * sees literal `path:`, `<Tabs.Screen`, `<Stack.Screen` etc. text in these four files. It is a floor,
 * not a ceiling: it catches "forgot to add the screen" and "put it in the wrong place", not "built
 * the screen wrong". See docs/TRAPS.md #1, "The check that passes because it doesn't do the real
 * thing" — the discipline here is to fail loudly (see PARSE FAILURE below) rather than quietly
 * matching nothing and calling that a pass.
 *
 * Run: npm run check:parity
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');
const repoRoot = join(mobileRoot, '..');

const routerPath = join(repoRoot, 'frontend', 'src', 'router.tsx');
const bottomNavPath = join(repoRoot, 'frontend', 'src', 'components', 'BottomNav.tsx');
const appPath = join(mobileRoot, 'App.tsx');
const navigationPath = join(mobileRoot, 'src', 'navigation.ts');

const routerSrc = readFileSync(routerPath, 'utf8');
const bottomNavSrc = readFileSync(bottomNavPath, 'utf8');
const appSrc = readFileSync(appPath, 'utf8');
const navigationSrc = readFileSync(navigationPath, 'utf8');

// ─── deliberate, reasoned exceptions ─────────────────────────────────────────
//
// Every entry must carry a reason. An allow-list with no reason field is how a
// real gap quietly becomes "expected" — see the brief this script was built from.

/** Web routes with no mobile counterpart, and why that's correct. Matched by path PREFIX. */
const ACCEPTED_WEB_ONLY = [
  {
    path: '/admin',
    reason:
      'Desktop-only ops panel, deliberately outside AppShell/BottomNav on the web too. ' +
      'The real gate is server-side (every /admin API 404s to non-ops); there is no case for a mobile admin UI.',
  },
];

/** Mobile screens/tabs with no web counterpart, and why that's correct. Matched by component base name. */
const ACCEPTED_MOBILE_ONLY = [
  {
    component: 'FeltGallery',
    reason:
      "Dev-only felt rendering harness reached from Settings -> Developer, registered only under " +
      "__DEV__ in App.tsx and absent from release builds. Has no web equivalent by design.",
  },
];

// ─── tiny text-parsing helpers (regex only, no AST, no bundler) ─────────────

/** Index of the character matching the bracket at `openIdx` (text[openIdx] must be `open`). */
function matchingBracket(text, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The `children: [ ... ]` array belonging to the route object containing `pathLiteral` (e.g. "'/',"). */
function childrenBlock(text, pathLiteral) {
  const containerIdx = text.indexOf(`path: ${pathLiteral}`);
  if (containerIdx === -1) return null;
  const childrenKeyIdx = text.indexOf('children:', containerIdx);
  if (childrenKeyIdx === -1) return null;
  const open = text.indexOf('[', childrenKeyIdx);
  const close = matchingBracket(text, open, '[', ']');
  if (open === -1 || close === -1) return null;
  return { start: open, end: close + 1, text: text.slice(open, close + 1) };
}

/** `{ path: 'x', element: <Comp ... }` or `{ index: true, element: <Comp ... }` entries, in order. */
const ROUTE_ENTRY_RE = /\{\s*(index:\s*true|path:\s*'[^']+')\s*,\s*element:\s*<(\w+)/g;

function extractRouteEntries(blockText) {
  const entries = [];
  let m;
  ROUTE_ENTRY_RE.lastIndex = 0;
  while ((m = ROUTE_ENTRY_RE.exec(blockText))) {
    const head = m[1];
    const component = m[2];
    if (head.startsWith('index')) {
      entries.push({ isIndex: true, path: '', component });
    } else {
      const path = head.match(/'([^']+)'/)[1];
      entries.push({ isIndex: false, path, component });
    }
  }
  return entries;
}

// ─── 1 & 2. parse the web: router.tsx and BottomNav.tsx ────────────────────

const tabShell = childrenBlock(routerSrc, "'/',");
const adminShell = childrenBlock(routerSrc, "'/admin',");

if (!tabShell) {
  fail('PARSE FAILURE: could not find the AppShell ("path: \'/\',") children block in router.tsx. ' +
    'The route table shape changed — update check-parity.mjs, do not let this pass silently.');
}
if (!adminShell) {
  fail('PARSE FAILURE: could not find the AdminShell ("path: \'/admin\',") children block in router.tsx.');
}

// Every route entry carries a `fullPath` computed for its own category — the raw `path:` capture
// has a leading slash for the standalone entries (written as `'/table/:id'` in router.tsx) but not
// for the nested ones (written as `'alliance'`, `'withdrawals'`), so this cannot be one blanket rule.
const tabShellRoutes = extractRouteEntries(tabShell.text).map((r) => ({
  ...r,
  fullPath: r.isIndex ? '/' : `/${r.path}`,
})); // routes rendered inside the tab bar shell
const adminRoutes = extractRouteEntries(adminShell.text).map((r) => ({
  ...r,
  fullPath: r.isIndex ? '/admin' : `/admin/${r.path}`,
}));

// Standalone top-level routes: everything left after cutting out both children blocks, minus the
// two shell wrapper components themselves (AppShell, AdminShell — layout, not pages).
const cutStart = Math.min(tabShell.start, adminShell.start);
const cutEnd = Math.max(tabShell.end, adminShell.end);
// Remove the LATER block first so the earlier block's offsets stay valid.
let remainder = routerSrc;
const blocksByStart = [tabShell, adminShell].sort((a, b) => b.start - a.start);
for (const b of blocksByStart) {
  remainder = remainder.slice(0, b.start) + remainder.slice(b.end);
}
const SHELL_COMPONENTS = new Set(['AppShell', 'AdminShell']);
const standaloneRoutes = extractRouteEntries(remainder)
  .filter((r) => !SHELL_COMPONENTS.has(r.component))
  .map((r) => ({ ...r, fullPath: r.isIndex ? '/' : r.path })); // standalone paths already carry their own leading slash

if (tabShellRoutes.length === 0) {
  fail('PARSE FAILURE: extracted zero routes from the tab-shell block of router.tsx. ' +
    'Either the file is empty of routes (impossible) or the regex stopped matching — treat this as broken, not clean.');
}

// BottomNav.tsx: the `tabs` array, in order.
const tabsArrayStart = bottomNavSrc.indexOf('const tabs');
if (tabsArrayStart === -1) {
  fail('PARSE FAILURE: could not find `const tabs` in BottomNav.tsx.');
}
const tabsOpen = bottomNavSrc.indexOf('[', bottomNavSrc.indexOf('=', tabsArrayStart));
const tabsClose = matchingBracket(bottomNavSrc, tabsOpen, '[', ']');
if (tabsOpen === -1 || tabsClose === -1) {
  fail('PARSE FAILURE: could not bracket-match the `tabs` array in BottomNav.tsx.');
}
const tabsBlockText = bottomNavSrc.slice(tabsOpen, tabsClose + 1);
const TAB_ENTRY_RE = /\{\s*to:\s*'([^']+)'\s*,\s*key:\s*'([^']+)'/g;
const webTabs = [];
let tm;
while ((tm = TAB_ENTRY_RE.exec(tabsBlockText))) {
  webTabs.push({ to: tm[1], key: tm[2] });
}
if (webTabs.length === 0) {
  fail('PARSE FAILURE: extracted zero tabs from BottomNav.tsx — the regex found nothing, not "no tabs".');
}

// Resolve each web tab's `to` path to the router component it renders.
function resolveWebPath(to) {
  if (to === '/') return tabShellRoutes.find((r) => r.isIndex);
  const path = to.replace(/^\//, '');
  return tabShellRoutes.find((r) => !r.isIndex && r.path === path);
}
const webTabsResolved = webTabs.map((t) => ({ ...t, route: resolveWebPath(t.to) }));
const unresolvedWebTabs = webTabsResolved.filter((t) => !t.route);
if (unresolvedWebTabs.length > 0) {
  fail(
    `PARSE FAILURE: BottomNav.tsx points at path(s) not found among router.tsx's tab-shell routes: ` +
      unresolvedWebTabs.map((t) => t.to).join(', '),
  );
}

const webLandingRoute = tabShellRoutes.find((r) => r.isIndex);
if (!webLandingRoute) {
  fail('PARSE FAILURE: no `index: true` route found in router.tsx\'s tab-shell block — cannot determine the web landing page.');
}

// ─── 3. parse the mobile: App.tsx and navigation.ts ─────────────────────────

/** Slice `text` into chunks starting at each occurrence of `tagOpen`, each running to the next occurrence (or a generous tail). */
function splitByTag(text, tagOpen) {
  const idxs = [];
  let i = -1;
  while ((i = text.indexOf(tagOpen, i + 1)) !== -1) idxs.push(i);
  return idxs.map((start, k) => text.slice(start, idxs[k + 1] !== undefined ? idxs[k + 1] : start + 1500));
}

// Segment-based rather than "match to the next `/>`": several Tabs.Screen entries contain a nested
// self-closing icon tag (e.g. `<AllianceIcon ... />`) INSIDE tabBarIcon, which a naive `[\s\S]*?\/>`
// would stop at, truncating the match before the real closing tag. Splitting on the next literal
// `<Tabs.Screen`/`<Stack.Screen` instead sidesteps that; name/component/title all appear before any
// nested icon tag in every entry, in this file, today — if that ordering ever changes this would
// silently under-read a field, which is exactly the kind of regex limit this script cannot see past.
function extractScreens(segments) {
  return segments
    .map((seg) => {
      const name = seg.match(/name="(\w+)"/);
      const component = seg.match(/component=\{(\w+)\}/);
      const title = seg.match(/title:\s*t\('([^']+)'\)/);
      if (!name || !component) return null;
      return { name: name[1], component: component[1], titleKey: title ? title[1] : null };
    })
    .filter(Boolean);
}

const tabScreens = extractScreens(splitByTag(appSrc, '<Tabs.Screen'));
const stackScreensAll = extractScreens(splitByTag(appSrc, '<Stack.Screen'));
// "Tabs" is the stack entry that hosts the tab navigator itself — a container, not a page.
const stackScreens = stackScreensAll.filter((s) => s.name !== 'Tabs');

if (tabScreens.length === 0) {
  fail('PARSE FAILURE: extracted zero <Tabs.Screen> entries from App.tsx. ' +
    'Either the tab navigator is empty (should be impossible — the app would have no tabs) or the regex broke — treat as broken.');
}
if (stackScreensAll.length === 0) {
  fail('PARSE FAILURE: extracted zero <Stack.Screen> entries from App.tsx.');
}

// Screens rendered directly (not registered in either navigator) — currently just LoginScreen,
// shown outside the NavigationContainer while status === 'signedOut'. Caught separately so the
// web's `login` route isn't reported missing just because it isn't a *routed* mobile screen.
const DIRECT_RENDER_RE = /<(\w+Screen)\s*\/>/g;
const directRenderScreens = [];
let dm;
while ((dm = DIRECT_RENDER_RE.exec(appSrc))) {
  directRenderScreens.push(dm[1]);
}

const initialRouteMatch = appSrc.match(/initialRouteName="(\w+)"/);
const mobileTabInitial = initialRouteMatch ? initialRouteMatch[1] : null;
if (!mobileTabInitial) {
  fail('PARSE FAILURE: no `initialRouteName="..."` found in App.tsx — cannot determine the mobile landing tab.');
}

// navigation.ts: RootStackParamList keys, as a cross-check against App.tsx's own Stack.Screen names.
const paramListStart = navigationSrc.indexOf('RootStackParamList = {');
if (paramListStart === -1) {
  fail('PARSE FAILURE: could not find `RootStackParamList` in navigation.ts.');
}
const paramListOpen = navigationSrc.indexOf('{', paramListStart);
const paramListClose = matchingBracket(navigationSrc, paramListOpen, '{', '}');
const paramListText = navigationSrc.slice(paramListOpen, paramListClose + 1);
const PARAM_KEY_RE = /(\w+)\s*:\s*(?:undefined|\{[^}]*\})\s*;/g;
const paramListKeys = [];
let pm;
while ((pm = PARAM_KEY_RE.exec(paramListText))) paramListKeys.push(pm[1]);

// ─── component-name normalization ───────────────────────────────────────────
// Mobile components are `<Name>Screen`; web components are `<Name>`. Strip the suffix to compare.
const stripScreen = (c) => (c.endsWith('Screen') ? c.slice(0, -'Screen'.length) : c);

const mobileComponents = new Map(); // base name -> { source, raw }
for (const s of tabScreens) mobileComponents.set(stripScreen(s.component), { source: `tab:${s.name}`, raw: s.component });
for (const s of stackScreens) mobileComponents.set(stripScreen(s.component), { source: `stack:${s.name}`, raw: s.component });
for (const c of directRenderScreens) {
  const base = stripScreen(c);
  if (!mobileComponents.has(base)) mobileComponents.set(base, { source: 'direct-render (auth gate)', raw: c });
}

const acceptedWebOnly = (fullPath) => ACCEPTED_WEB_ONLY.find((e) => fullPath === e.path || fullPath.startsWith(e.path + '/'));
const acceptedMobileOnly = (base) => ACCEPTED_MOBILE_ONLY.find((e) => e.component === base);

// ─── 4. compare: every web page has a mobile screen ─────────────────────────

const failures = [];
const rows = [];

function checkWebRoute(route, location) {
  const path = route.fullPath;
  const accepted = acceptedWebOnly(path);
  const hasMobile = mobileComponents.has(route.component);
  if (accepted) {
    rows.push([path, location, route.component, 'EXCLUDED', accepted.reason]);
  } else if (hasMobile) {
    rows.push([path, location, route.component, `OK (${mobileComponents.get(route.component).source})`, '']);
  } else {
    rows.push([path, location, route.component, 'MISSING', '']);
    failures.push(`web route ${path} (component <${route.component}/>) has no mobile screen. ` +
      `Add a "${route.component}Screen" reachable from mobile/App.tsx, or add it to ACCEPTED_WEB_ONLY with a reason.`);
  }
}

for (const r of tabShellRoutes) checkWebRoute(r, 'tab-shell');
for (const r of standaloneRoutes) checkWebRoute(r, 'standalone');
for (const r of adminRoutes) checkWebRoute(r, 'admin (desktop-only)');

// ─── mobile screens with no web counterpart ──────────────────────────────────

const webComponentBases = new Set([
  ...tabShellRoutes.map((r) => r.component),
  ...standaloneRoutes.map((r) => r.component),
  ...adminRoutes.map((r) => r.component),
]);

for (const [base, info] of mobileComponents) {
  if (webComponentBases.has(base)) continue;
  const accepted = acceptedMobileOnly(base);
  if (accepted) {
    rows.push(['(mobile-only)', info.source, info.raw, 'EXCLUDED', accepted.reason]);
  } else {
    rows.push(['(mobile-only)', info.source, info.raw, 'EXTRA', '']);
    failures.push(`mobile screen ${info.raw} (${info.source}) has no web route. ` +
      `Remove it, or add "${base}" to ACCEPTED_MOBILE_ONLY with a reason.`);
  }
}

// ─── tab bar: same pages, same order ────────────────────────────────────────

const webTabComponents = webTabsResolved.map((t) => t.route.component);
const mobileTabComponents = tabScreens.map((s) => stripScreen(s.component));

const webTabSet = new Set(webTabComponents);
const mobileTabSet = new Set(mobileTabComponents);
const missingFromMobileTabs = webTabComponents.filter((c) => !mobileTabSet.has(c));
const extraInMobileTabs = mobileTabComponents.filter((c) => !webTabSet.has(c));

if (missingFromMobileTabs.length > 0) {
  failures.push(`mobile tab bar is missing: ${missingFromMobileTabs.join(', ')} (present in the web's BottomNav).`);
}
if (extraInMobileTabs.length > 0) {
  failures.push(`mobile tab bar has extra tab(s) not on the web: ${extraInMobileTabs.join(', ')}.`);
}
if (missingFromMobileTabs.length === 0 && extraInMobileTabs.length === 0) {
  if (JSON.stringify(webTabComponents) !== JSON.stringify(mobileTabComponents)) {
    failures.push(
      `tab ORDER differs.\n    web:    ${webTabComponents.join(' -> ')}\n    mobile: ${mobileTabComponents.join(' -> ')}`,
    );
  }
}

// ─── landing screen ──────────────────────────────────────────────────────────

// Stack's own initial screen: an explicit initialRouteName on <Stack.Navigator ...>, else the first
// declared <Stack.Screen>. Neither is present as a Stack-level initialRouteName here (only the
// nested Tabs.Navigator has one), so this resolves to the first Stack.Screen: "Tabs".
const stackNavigatorInitial = (() => {
  const tag = appSrc.match(/<Stack\.Navigator[\s\S]*?>/);
  const explicit = tag ? tag[0].match(/initialRouteName="(\w+)"/) : null;
  if (explicit) return explicit[1];
  return stackScreensAll[0] ? stackScreensAll[0].name : null;
})();

let mobileLandingComponent = null;
let landingNote = '';
if (stackNavigatorInitial === 'Tabs') {
  const tabsWrapperScreen = stackScreensAll.find((s) => s.name === 'Tabs');
  if (tabsWrapperScreen && tabsWrapperScreen.component === 'TabsScreen') {
    const initialTab = tabScreens.find((s) => s.name === mobileTabInitial);
    if (initialTab) {
      mobileLandingComponent = stripScreen(initialTab.component);
      landingNote = `Stack -> "Tabs" (TabsScreen) -> initialRouteName="${mobileTabInitial}" -> ${initialTab.component}`;
    }
  }
} else {
  const screen = stackScreensAll.find((s) => s.name === stackNavigatorInitial);
  if (screen) {
    mobileLandingComponent = stripScreen(screen.component);
    landingNote = `Stack -> "${stackNavigatorInitial}" -> ${screen.component}`;
  }
}

if (!mobileLandingComponent) {
  failures.push(
    'PARSE FAILURE: could not resolve the mobile landing screen through the stack/tab structure App.tsx ' +
      'actually has — the assumed "Stack opens on Tabs, Tabs opens on initialRouteName" shape did not match. ' +
      'Fix the resolver in check-parity.mjs rather than trusting a guess.',
  );
} else if (mobileLandingComponent !== webLandingRoute.component) {
  failures.push(
    `landing screen differs: web opens on <${webLandingRoute.component}/> (router.tsx index route), ` +
      `mobile opens on <${mobileLandingComponent}Screen/> (${landingNote}).`,
  );
}

// ─── navigation.ts cross-check (bonus: catches a stale param-list type) ─────

const stackScreenNames = new Set(stackScreensAll.map((s) => s.name));
const paramListSet = new Set(paramListKeys);
const missingFromParamList = [...stackScreenNames].filter((n) => !paramListSet.has(n));
const extraInParamList = [...paramListSet].filter((n) => !stackScreenNames.has(n));
if (missingFromParamList.length > 0) {
  failures.push(`navigation.ts RootStackParamList is missing screen(s) App.tsx registers: ${missingFromParamList.join(', ')}.`);
}
if (extraInParamList.length > 0) {
  failures.push(`navigation.ts RootStackParamList declares screen(s) App.tsx never registers: ${extraInParamList.join(', ')}.`);
}

// ─── report ───────────────────────────────────────────────────────────────

function fail(message) {
  console.error(`\ncheck:parity — ${message}\n`);
  process.exit(1);
}

console.log('Parity check — frontend/src (web) vs mobile/ (native)\n');

console.log('Routes / screens:');
console.log('  web path            location               component          mobile              note');
for (const [path, location, component, status, note] of rows) {
  console.log(
    `  ${path.padEnd(20)}${location.padEnd(23)}${component.padEnd(19)}${status.padEnd(20)}${note}`,
  );
}

console.log('\nTab bar order:');
console.log(`  web:    ${webTabComponents.join(' -> ')}`);
console.log(`  mobile: ${mobileTabComponents.join(' -> ')}`);

console.log('\nLanding screen:');
console.log(`  web:    <${webLandingRoute.component}/> (router.tsx index route)`);
console.log(`  mobile: ${mobileLandingComponent ? `<${mobileLandingComponent}Screen/>` : 'UNRESOLVED'} (${landingNote || 'n/a'})`);

if (failures.length > 0) {
  console.error(`\ncheck:parity — ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nEvery non-game screen must exist on both sides, mobile\'s tab bar must match the web\'s ' +
      'tabs and order, and both must land on the same page. If a difference is deliberate, add it to ' +
      'ACCEPTED_WEB_ONLY / ACCEPTED_MOBILE_ONLY at the top of check-parity.mjs with a one-line reason.',
  );
  process.exit(1);
}

console.log(
  `\nparity ok — ${rows.length} route/screen row(s), ${webTabComponents.length} tabs in matching order, landing screen matches.`,
);
