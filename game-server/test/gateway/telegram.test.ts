import { createHmac } from 'node:crypto';
import {
  verifyInitData,
  playerIdForTelegramUser,
  displayNameFor,
  type TelegramUser,
} from '../../src/gateway/telegram';

/**
 * These tests are the ones that matter: the accept path proves login works, but
 * the reject paths are what stop anyone signing in as someone else. Each one
 * corresponds to a real forgery attempt.
 */

const BOT_TOKEN = '123456:TEST-BOT-TOKEN-not-a-real-one';
const NOW = 1_770_000_000;

/** Build a correctly-signed initData string, exactly as Telegram would. */
function signInitData(
  fields: Record<string, string>,
  botToken = BOT_TOKEN,
): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

const USER: TelegramUser = { id: 4242, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' };

function validFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(NOW - 60),
    query_id: 'AAterFAKEqueryid',
    user: JSON.stringify(USER),
    ...overrides,
  };
}

const opts = { maxAgeSeconds: 86_400, nowSeconds: NOW };

describe('verifyInitData — accepts genuine payloads', () => {
  it('accepts a correctly signed payload and returns the user', () => {
    const result = verifyInitData(signInitData(validFields()), BOT_TOKEN, opts);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.user.id).toBe(4242);
    expect(result.user.username).toBe('ada');
    expect(result.authDate).toBe(NOW - 60);
  });

  it('accepts regardless of field order in the query string', () => {
    const fields = validFields();
    const signed = signInitData(fields);
    // Reverse the parameter order; the signature is over sorted keys, so it holds.
    const reordered = [...new URLSearchParams(signed).entries()].reverse();
    const shuffled = new URLSearchParams(reordered).toString();

    expect(verifyInitData(shuffled, BOT_TOKEN, opts).ok).toBe(true);
  });

  it('accepts a payload right at the age limit', () => {
    const fields = validFields({ auth_date: String(NOW - 86_400) });
    expect(verifyInitData(signInitData(fields), BOT_TOKEN, opts).ok).toBe(true);
  });
});

describe('verifyInitData — rejects forgeries', () => {
  it('rejects a tampered hash', () => {
    const signed = signInitData(validFields());
    const tampered = signed.replace(/hash=[0-9a-f]+/, `hash=${'0'.repeat(64)}`);

    const result = verifyInitData(tampered, BOT_TOKEN, opts);
    expect(result).toEqual({ ok: false, reason: 'signature does not match' });
  });

  it('rejects a payload whose user was swapped after signing', () => {
    // The attack this defends against: take your own valid initData and edit the
    // user id to somebody else's.
    const signed = signInitData(validFields());
    const params = new URLSearchParams(signed);
    params.set('user', JSON.stringify({ ...USER, id: 9999 }));

    const result = verifyInitData(params.toString(), BOT_TOKEN, opts);
    expect(result.ok).toBe(false);
  });

  it('rejects a payload signed with a different bot token', () => {
    const signed = signInitData(validFields(), 'other:BOT-TOKEN');
    const result = verifyInitData(signed, BOT_TOKEN, opts);
    expect(result).toEqual({ ok: false, reason: 'signature does not match' });
  });

  it('rejects a stale payload', () => {
    const fields = validFields({ auth_date: String(NOW - 86_401) });
    const result = verifyInitData(signInitData(fields), BOT_TOKEN, opts);
    expect(result).toEqual({ ok: false, reason: 'initData has expired' });
  });

  it('rejects a payload with no hash', () => {
    const params = new URLSearchParams(signInitData(validFields()));
    params.delete('hash');
    expect(verifyInitData(params.toString(), BOT_TOKEN, opts)).toEqual({
      ok: false,
      reason: 'initData has no hash',
    });
  });

  it('rejects empty initData', () => {
    expect(verifyInitData('', BOT_TOKEN, opts)).toEqual({
      ok: false,
      reason: 'initData is empty',
    });
  });

  it('rejects everything when the server has no bot token', () => {
    // Otherwise a server booted without a token would sign with '' and accept
    // anything an attacker signed with '' too.
    expect(verifyInitData(signInitData(validFields()), '', opts)).toEqual({
      ok: false,
      reason: 'server has no bot token configured',
    });
  });

  it('rejects a validly signed payload that carries no user', () => {
    const fields = { auth_date: String(NOW - 60), query_id: 'AAtest' };
    expect(verifyInitData(signInitData(fields), BOT_TOKEN, opts)).toEqual({
      ok: false,
      reason: 'initData has no user',
    });
  });

  it('rejects a validly signed payload whose user id is not a number', () => {
    const fields = validFields({ user: JSON.stringify({ id: 'not-a-number' }) });
    expect(verifyInitData(signInitData(fields), BOT_TOKEN, opts)).toEqual({
      ok: false,
      reason: 'initData user has no numeric id',
    });
  });

  it('rejects a validly signed payload whose user is malformed JSON', () => {
    const fields = validFields({ user: '{not json' });
    expect(verifyInitData(signInitData(fields), BOT_TOKEN, opts)).toEqual({
      ok: false,
      reason: 'initData user is not valid JSON',
    });
  });

  it('rejects a missing auth_date even when the signature is valid', () => {
    const fields = { user: JSON.stringify(USER), query_id: 'AAtest' };
    expect(verifyInitData(signInitData(fields), BOT_TOKEN, opts)).toEqual({
      ok: false,
      reason: 'initData has no usable auth_date',
    });
  });
});

describe('identity derivation', () => {
  it('derives a stable player id from the telegram user id', () => {
    expect(playerIdForTelegramUser(4242)).toBe('tg-4242');
    // Stability matters: the same Telegram account must always map to the same
    // financial-core account, across logins and deploys.
    expect(playerIdForTelegramUser(4242)).toBe(playerIdForTelegramUser(4242));
  });

  it('builds a display name from whatever fields are present', () => {
    expect(displayNameFor(USER)).toBe('Ada Lovelace');
    expect(displayNameFor({ id: 1, first_name: 'Ada' })).toBe('Ada');
    expect(displayNameFor({ id: 1, username: 'ada' })).toBe('ada');
    expect(displayNameFor({ id: 7 })).toBe('Player 7');
  });
});
