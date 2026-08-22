#!/usr/bin/env node
/**
 * Exercises the device-integrity tiering against stubbed probes.
 *
 * The tiering is the part with a real decision in it, and it can be wrong in
 * two directions, both bad:
 *
 *   too eager — a developer with USB debugging on, or someone running a custom
 *               ROM, gets told their device is compromised on a money screen.
 *   too lax   — an actually rooted phone, or one running Frida, says nothing.
 *
 * Neither shows up in a typecheck, and neither can be tested on this machine
 * with a real device. What CAN be tested is the decision itself, by feeding
 * `readIntegrity()` known probe results. That is what this does.
 *
 * Run: npm run check:integrity
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(here, '..');
const require_ = createRequire(path.join(mobileRoot, '/'));
const ts = require_('typescript');

const source = readFileSync(path.join(mobileRoot, 'src', 'integrity.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/**
 * Loads integrity.ts with react-native and jail-monkey stubbed out.
 * `probes` supplies each answer; a function that throws simulates a probe
 * blowing up, which must report `null` rather than a confident `false`.
 */
function load({ platform = 'android', dev = false, probes = {} }) {
  const throwing = () => {
    throw new Error('probe exploded');
  };
  const P = {
    isJailBroken: () => false,
    hookDetected: () => false,
    isDebuggedMode: async () => false,
    canMockLocation: () => false,
    AdbEnabled: () => false,
    isDevelopmentSettingsMode: async () => false,
    isOnExternalStorage: () => false,
    ...probes,
  };
  for (const [k, v] of Object.entries(probes)) if (v === 'throw') P[k] = throwing;

  const fakeRequire = (id) => {
    if (id === 'react') return { useEffect: () => {}, useState: (v) => [v, () => {}] };
    if (id === 'react-native') return { Platform: { OS: platform } };
    if (id === 'jail-monkey') return { default: P, __esModule: true };
    throw new Error('unexpected import: ' + id);
  };

  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__DEV__', js)(
    fakeRequire,
    module,
    module.exports,
    dev,
  );
  return module.exports;
}

let failures = 0;
async function check(label, opts, expect) {
  const { readIntegrity } = load(opts);
  const result = await readIntegrity();
  try {
    expect(result);
    console.log(`  ok    ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${label}\n          ${e.message.split('\n')[0]}`);
  }
}

console.log('Device integrity tiering\n');

await check('a clean device is not flagged', {}, (r) => {
  assert.equal(r.compromised, false);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.checked, true);
});

await check('a rooted device is flagged', { probes: { isJailBroken: () => true } }, (r) => {
  assert.equal(r.compromised, true);
  assert.ok(r.reasons.includes('JAILBROKEN'));
});

await check('an instrumentation framework is flagged', { probes: { hookDetected: () => true } }, (r) => {
  assert.equal(r.compromised, true);
  assert.ok(r.reasons.includes('HOOKED'));
});

// The false-positive guard. This is the test that matters most: these are all
// ordinary states on a developer's or power user's phone.
await check(
  'ADVISORY signals alone do NOT flag the device',
  {
    probes: {
      AdbEnabled: () => true,
      isDevelopmentSettingsMode: async () => true,
      canMockLocation: () => true,
      isOnExternalStorage: () => true,
    },
  },
  (r) => {
    assert.equal(r.compromised, false, 'advisory signals must not accuse anyone');
    assert.deepEqual(r.reasons, []);
    // ...but they are still reported, so the server can weigh them later.
    assert.equal(r.signals.adbEnabled, true);
    assert.equal(r.signals.canMockLocation, true);
  },
);

await check(
  'a debugger in a DEV build is not flagged',
  { dev: true, probes: { isDebuggedMode: async () => true } },
  (r) => {
    assert.equal(r.compromised, false, 'a permanent warning for the people building the app');
    assert.equal(r.signals.debugged, true);
  },
);

await check(
  'a debugger in a RELEASE build IS flagged',
  { dev: false, probes: { isDebuggedMode: async () => true } },
  (r) => {
    assert.equal(r.compromised, true);
    assert.ok(r.reasons.includes('DEBUGGER'));
  },
);

await check(
  'a probe that throws reports null, not false',
  { probes: { isJailBroken: 'throw', hookDetected: 'throw' } },
  (r) => {
    assert.equal(r.signals.jailBroken, null, 'unknown must not be recorded as fine');
    assert.equal(r.signals.hookDetected, null);
    assert.equal(r.compromised, false, 'unknown is not grounds to accuse');
  },
);

await check('a throwing probe never rejects', { probes: { isDebuggedMode: 'throw' } }, (r) => {
  assert.equal(r.signals.debugged, null);
  assert.equal(r.checked, true);
});

await check(
  'android-only probes are null on iOS, not false',
  { platform: 'ios', probes: { AdbEnabled: () => true, canMockLocation: () => true } },
  (r) => {
    assert.equal(r.signals.adbEnabled, null, 'a default must not be recorded as a real answer');
    assert.equal(r.signals.canMockLocation, null);
    assert.equal(r.signals.onExternalStorage, null);
    // Cross-platform probes still run.
    assert.equal(r.signals.jailBroken, false);
  },
);

await check(
  'multiple critical signals are all reported',
  { probes: { isJailBroken: () => true, hookDetected: () => true } },
  (r) => {
    assert.equal(r.compromised, true);
    assert.deepEqual(r.reasons.sort(), ['HOOKED', 'JAILBROKEN']);
  },
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
console.log('NOTE: stubbed probes. That the SDK reports correctly on real');
console.log('hardware is the physical-device gate, and is still outstanding.');
