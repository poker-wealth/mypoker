import {
  saveUploadedAvatar,
  getAvatarImage,
  MAX_STORED_AVATAR_BYTES,
} from '../../src/settings/avatar-store';
import { getSettings, updateSettings, UPLOADED_AVATAR } from '../../src/settings/player-settings';
import { startTestDb, stopTestDb, clearCollections } from '../db-helper';

/**
 * `saveUploadedAvatar` is the one place `UPLOADED_AVATAR` is ever written. It
 * does two things together — store the bytes, flip the settings sentinel —
 * and the risky part is exactly the "together": a mismatch between the two
 * would either 404 an avatar the settings claim exists, or store a row
 * nothing ever points at.
 */

const PLAYER = 'p-avatar-store-test';

beforeAll(startTestDb);
afterAll(stopTestDb);
afterEach(clearCollections);

describe('saveUploadedAvatar', () => {
  it('stores the bytes and marks settings.avatarId as UPLOADED_AVATAR', async () => {
    const bytes = Buffer.from('fake-jpeg-bytes');
    await saveUploadedAvatar(PLAYER, bytes);

    const image = await getAvatarImage(PLAYER);
    expect(image).not.toBeNull();
    expect(Buffer.compare(image!.data, bytes)).toBe(0);
    expect(image!.contentType).toBe('image/jpeg');

    const settings = await getSettings(PLAYER);
    expect(settings.avatarId).toBe(UPLOADED_AVATAR);
  });

  it('a re-upload overwrites the previous image wholesale', async () => {
    await saveUploadedAvatar(PLAYER, Buffer.from('first'));
    await saveUploadedAvatar(PLAYER, Buffer.from('second'));

    const image = await getAvatarImage(PLAYER);
    expect(image!.data.toString()).toBe('second');
  });

  it('rejects an empty buffer', async () => {
    await expect(saveUploadedAvatar(PLAYER, Buffer.alloc(0))).rejects.toThrow(RangeError);
    expect(await getAvatarImage(PLAYER)).toBeNull();
  });

  it('rejects a buffer over the size backstop, even though the gateway should never send one this large', async () => {
    const tooBig = Buffer.alloc(MAX_STORED_AVATAR_BYTES + 1, 1);
    await expect(saveUploadedAvatar(PLAYER, tooBig)).rejects.toThrow(RangeError);
    expect(await getAvatarImage(PLAYER)).toBeNull();
  });

  it('does not affect another player', async () => {
    await saveUploadedAvatar(PLAYER, Buffer.from('mine'));
    expect(await getAvatarImage('someone-else')).toBeNull();
    expect((await getSettings('someone-else')).avatarId).toBeNull();
  });
});

describe('getAvatarImage', () => {
  it('returns null for a player who never uploaded', async () => {
    expect(await getAvatarImage('p-never-uploaded')).toBeNull();
  });
});

describe('the settings guard still refuses arbitrary text (the enum is not weakened)', () => {
  it('accepts a curated avatarId as before', async () => {
    const settings = await updateSettings(PLAYER, { avatarId: 'a-star' });
    expect(settings.avatarId).toBe('a-star');
  });

  it('accepts UPLOADED_AVATAR only because it is the exact sentinel — not because the check got looser', async () => {
    const settings = await updateSettings(PLAYER, { avatarId: UPLOADED_AVATAR });
    expect(settings.avatarId).toBe(UPLOADED_AVATAR);
  });

  it('still rejects any other free text, including near-misses of the sentinel', async () => {
    await updateSettings(PLAYER, { avatarId: 'a-crown' });

    for (const bad of ['uploaded ', 'Uploaded', 'uploaded-2', 'not-a-real-avatar', '<script>']) {
      await expect(
        updateSettings(PLAYER, { avatarId: bad as unknown as 'a-crown' }),
      ).rejects.toThrow(RangeError);
    }
    // None of the rejected writes touched the previously stored choice.
    expect((await getSettings(PLAYER)).avatarId).toBe('a-crown');
  });
});
