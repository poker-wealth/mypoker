const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * Metro, taught to see one directory outside this project: the Mini App's
 * translations.
 *
 * The alternative was copying `frontend/src/i18n/locales/*.json` in here — 471
 * keys across 8 languages, duplicated. They would drift the first time someone
 * added a key on one side, and a missing key renders RAW on screen, which has
 * already shipped more than once on the web app. One copy, two consumers.
 *
 * `watchFolders` lets Metro resolve files above the project root;
 * `nodeModulesPaths` keeps module resolution anchored here so the frontend's
 * own dependencies are never pulled into the native bundle.
 *
 * The frontend's `npm run build` runs `check:locales`, which fails on an
 * incomplete set — so the guard that keeps these files honest already exists
 * and now covers the app too.
 */
const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.resolve(repoRoot, 'frontend/src/i18n/locales')];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
