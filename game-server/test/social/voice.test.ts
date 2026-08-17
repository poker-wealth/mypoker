import {
  evaluateVoice,
  base64Bytes,
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_MS,
  MIN_VOICE_DURATION_MS,
} from '../../src/social/voice';
import { newChatterState, mute, RATE_LIMIT_MESSAGES } from '../../src/social/chat';
import { MAX_MESSAGE_BYTES } from '../../src/transport/protocol';

/**
 * Voice notes (SAMUEL_V2 task 2).
 *
 * Two things are being protected here, and they are different:
 *
 *   The CAPS keep a clip inside the socket's frame budget. `ws` does not reject
 *   an oversized frame politely — it fails the connection — so a voice note
 *   that slipped past these would knock its sender out of a live hand. That is
 *   the "a voice error must never affect the game" rule, and it is arithmetic,
 *   not judgement.
 *
 *   The GATES keep voice from becoming a way around the chat rules. A muted
 *   player must not be able to say it out loud instead.
 */

const OK_MIME = 'audio/webm;codecs=opus';
/** A base64 string that decodes to exactly `bytes`. */
const clipOf = (bytes: number): string => Buffer.alloc(bytes, 7).toString('base64');
/** GOOD standing. The scale is 0–1000 and chat closes below 300, not below 100. */
const GOOD_STANDING = 800;
const req = (over: Partial<Parameters<typeof evaluateVoice>[1]> = {}) => ({
  reputationScore: GOOD_STANDING,
  isSpectator: false,
  durationMs: 3_000,
  clip: clipOf(8 * 1024),
  mime: OK_MIME,
  now: Date.now(),
  ...over,
});

describe('base64Bytes', () => {
  it.each([0, 1, 2, 3, 100, 1023, 24 * 1024])('measures %i bytes without decoding', (n) => {
    // The cap is enforced with this, so it being right IS the size guarantee.
    // Measuring rather than decoding is the point: a hostile client should not
    // be able to make the room allocate what it is about to refuse.
    expect(base64Bytes(clipOf(n))).toBe(n);
  });
});

describe('the caps keep a clip inside the socket frame budget', () => {
  it('accepts a clip at exactly the byte cap', () => {
    expect(evaluateVoice(newChatterState(), req({ clip: clipOf(MAX_VOICE_BYTES) })).ok).toBe(true);
  });

  it('refuses one byte over', () => {
    const d = evaluateVoice(newChatterState(), req({ clip: clipOf(MAX_VOICE_BYTES + 1) }));
    expect(d).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  it('leaves room for the envelope inside the 64KB frame limit', () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A legal clip, base64'd and wrapped in
    // the envelope (payload is JSON-encoded inside another JSON object, so it
    // is counted twice), must still fit in one frame with room to spare. If a
    // future change raises MAX_VOICE_BYTES past this, the socket starts closing
    // on send and players get dropped mid-hand — so fail here instead.
    const clip = clipOf(MAX_VOICE_BYTES);
    const inner = JSON.stringify({
      type: 'action',
      roomId: 'a-reasonably-long-room-identifier',
      action: { kind: 'voice', clip, durationMs: MAX_VOICE_DURATION_MS, mime: OK_MIME },
    });
    const onWire = JSON.stringify({ seq: 999_999, payload: inner, mac: 'f'.repeat(64) });

    expect(onWire.length).toBeLessThan(MAX_MESSAGE_BYTES);
    // And not merely fitting — comfortably inside, so envelope changes have slack.
    expect(onWire.length).toBeLessThan(MAX_MESSAGE_BYTES * 0.75);
  });

  it.each([
    ['too long', MAX_VOICE_DURATION_MS + 1, 'TOO_LONG_AUDIO'],
    ['a fumbled press', MIN_VOICE_DURATION_MS - 1, 'TOO_SHORT_AUDIO'],
  ])('refuses %s', (_label, durationMs, reason) => {
    expect(evaluateVoice(newChatterState(), req({ durationMs }))).toEqual({ ok: false, reason });
  });

  it('accepts both browser families — Opus/WebM and iOS mp4', () => {
    for (const mime of ['audio/webm;codecs=opus', 'audio/mp4']) {
      expect(evaluateVoice(newChatterState(), req({ mime })).ok).toBe(true);
    }
  });

  it('refuses a container we did not agree to relay', () => {
    // Not paranoia about audio: this is a string the room fans out to every
    // client at the table, which then hands it to a media element.
    for (const mime of ['audio/x-anything', 'text/html', 'application/javascript']) {
      expect(evaluateVoice(newChatterState(), req({ mime }))).toEqual({ ok: false, reason: 'BAD_FORMAT' });
    }
  });

  it('checks size before spending the sender rate-limit budget', () => {
    // An oversized clip should be refused for its size, not silently consume a
    // send and come back RATE_LIMITED — which would be a confusing thing to
    // show someone whose microphone is simply producing large files.
    const state = newChatterState();
    for (let i = 0; i < RATE_LIMIT_MESSAGES + 2; i++) {
      expect(evaluateVoice(state, req({ clip: clipOf(MAX_VOICE_BYTES + 1) })).ok).toBe(false);
    }
    expect(evaluateVoice(state, req()).ok).toBe(true); // budget untouched
  });
});

describe('voice obeys every rule text chat obeys', () => {
  it('a muted player cannot say it out loud instead', () => {
    // The whole reason this reuses evaluateChat rather than re-deriving it.
    const state = newChatterState();
    mute(state, Date.now() + 60_000);
    expect(evaluateVoice(state, req())).toEqual({ ok: false, reason: 'MUTED' });
  });

  it('a spectator cannot voice into a live hand', () => {
    expect(evaluateVoice(newChatterState(), req({ isSpectator: true }))).toEqual({
      ok: false,
      reason: 'SPECTATORS_CANNOT_CHAT',
    });
  });

  it.each([0, 100, 299])('a reputation too low to type is too low to talk (%i)', (score) => {
    // 299 is the top of VERY_POOR — the exact boundary where chat closes, so a
    // change to the band edges fails here rather than quietly granting a voice
    // channel to accounts that lost the text one.
    expect(evaluateVoice(newChatterState(), req({ reputationScore: score }))).toEqual({
      ok: false,
      reason: 'REPUTATION_TOO_LOW',
    });
  });

  it('POOR standing keeps both channels — the gate is VERY_POOR, not "not great"', () => {
    expect(evaluateVoice(newChatterState(), req({ reputationScore: 300 })).ok).toBe(true);
  });

  it('shares ONE rate-limit budget with text', () => {
    // Otherwise the limit is simply doubled by alternating the two.
    const state = newChatterState();
    const now = Date.now();
    for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) {
      const d = evaluateVoice(state, req({ now }));
      expect(d.ok).toBe(true);
      // recordVoice IS recordMessage — same array, same window.
      (state.recent as number[]).push(now);
    }
    expect(evaluateVoice(state, req({ now }))).toEqual({ ok: false, reason: 'RATE_LIMITED' });
  });
});
