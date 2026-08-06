import {
  getSettings,
  updateSettings,
  DEFAULT_SETTINGS,
  PlayerSettingsModel,
} from '../../src/settings/player-settings';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';

/**
 * Settings are not money, but they are the first thing a player notices going
 * wrong — a sound toggle that silently reverts reads as a broken app.
 *
 * The risky parts are the upsert (a first write must not need a prior row) and
 * partial updates (writing one field must not reset the others to defaults).
 */

const PLAYER = 'p-settings-test';

beforeAll(startTestDb);
afterAll(stopTestDb);
afterEach(clearCollections);

describe('getSettings', () => {
  it('returns defaults for a player who has never opened Settings', async () => {
    const settings = await getSettings(PLAYER);
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults promos to off — an opt-out is not consent', async () => {
    expect(DEFAULT_SETTINGS.notifyPromos).toBe(false);
    expect(DEFAULT_SETTINGS.notifyResults).toBe(true);
  });

  it('reads back nothing for one player that another player wrote', async () => {
    await updateSettings(PLAYER, { sound: false });
    expect((await getSettings('p-someone-else')).sound).toBe(true);
  });
});

describe('updateSettings', () => {
  it('creates the row on first write without a prior read', async () => {
    expect(await PlayerSettingsModel.findById(PLAYER).lean()).toBeNull();

    const settings = await updateSettings(PLAYER, { sound: false });

    expect(settings.sound).toBe(false);
    expect(await PlayerSettingsModel.findById(PLAYER).lean()).not.toBeNull();
  });

  it('leaves untouched fields alone', async () => {
    await updateSettings(PLAYER, { sound: false, notifyPromos: true });
    const settings = await updateSettings(PLAYER, { haptics: false });

    // The earlier writes must survive a later partial update.
    expect(settings.sound).toBe(false);
    expect(settings.notifyPromos).toBe(true);
    expect(settings.haptics).toBe(false);
    expect(settings.notifyResults).toBe(true);
  });

  it('returns the full settled state, not just the patch', async () => {
    const settings = await updateSettings(PLAYER, { sound: false });
    expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('persists across reads', async () => {
    await updateSettings(PLAYER, { language: 'ja', notifyDeposits: false });
    const reread = await getSettings(PLAYER);

    expect(reread.language).toBe('ja');
    expect(reread.notifyDeposits).toBe(false);
  });

  it('treats explicit null as clearing the language override', async () => {
    await updateSettings(PLAYER, { language: 'ko' });
    expect((await getSettings(PLAYER)).language).toBe('ko');

    // null means "follow Telegram again" — distinct from omitting the field.
    await updateSettings(PLAYER, { language: null });
    expect((await getSettings(PLAYER)).language).toBeNull();
  });

  it('ignores undefined rather than unsetting the stored value', async () => {
    await updateSettings(PLAYER, { sound: false });
    // An absent JSON field arrives as undefined; it must not clear anything.
    await updateSettings(PLAYER, { sound: undefined, haptics: false });

    const settings = await getSettings(PLAYER);
    expect(settings.sound).toBe(false);
    expect(settings.haptics).toBe(false);
  });

  it('is a no-op for an empty patch', async () => {
    await updateSettings(PLAYER, { sound: false });
    const settings = await updateSettings(PLAYER, {});
    expect(settings.sound).toBe(false);
  });

  it('does not create a row for an empty patch on an unknown player', async () => {
    await updateSettings('p-never-seen', {});
    expect(await PlayerSettingsModel.findById('p-never-seen').lean()).toBeNull();
  });
});
