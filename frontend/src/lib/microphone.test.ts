import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireMic, parkMic, stopMic, MIC_IDLE_MS } from './microphone';

/**
 * The microphone is asked for ONCE.
 *
 * Telegram's webview raises its own permission card on every `getUserMedia`
 * call, so "ask again on each press" is not a tidy default there — it is a
 * prompt in the player's face every time they hold the mic button. These pin
 * the sharing that fixed it, and the two ways the device still gets released.
 */

interface FakeTrack {
  kind: string;
  readyState: 'live' | 'ended';
  enabled: boolean;
  stop: () => void;
}

function fakeStream(): { stream: MediaStream; tracks: FakeTrack[] } {
  const tracks: FakeTrack[] = [
    {
      kind: 'audio',
      readyState: 'live',
      enabled: true,
      stop() {
        this.readyState = 'ended';
      },
    },
  ];
  const stream = {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
  } as unknown as MediaStream;
  return { stream, tracks };
}

let getUserMedia: ReturnType<typeof vi.fn>;
let current: { stream: MediaStream; tracks: FakeTrack[] };

beforeEach(() => {
  vi.useFakeTimers();
  current = fakeStream();
  getUserMedia = vi.fn().mockImplementation(() => Promise.resolve(current.stream));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  stopMic();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the shared microphone', () => {
  it('asks the browser once and reuses the stream on the next recording', async () => {
    const first = await acquireMic();
    parkMic();
    const second = await acquireMic();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('mutes between recordings, and un-mutes for the next one', async () => {
    await acquireMic();
    expect(current.tracks[0]!.enabled).toBe(true);

    parkMic();
    // Parked, not stopped: silent, but the grant is kept.
    expect(current.tracks[0]!.enabled).toBe(false);
    expect(current.tracks[0]!.readyState).toBe('live');

    await acquireMic();
    expect(current.tracks[0]!.enabled).toBe(true);
  });

  it('hands the device back after the idle window, and asks again next time', async () => {
    await acquireMic();
    parkMic();

    vi.advanceTimersByTime(MIC_IDLE_MS);
    expect(current.tracks[0]!.readyState).toBe('ended');

    current = fakeStream();
    await acquireMic();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('does not release while recordings keep coming', async () => {
    await acquireMic();
    parkMic();
    vi.advanceTimersByTime(MIC_IDLE_MS - 1);
    await acquireMic();
    vi.advanceTimersByTime(MIC_IDLE_MS - 1);

    expect(current.tracks[0]!.readyState).toBe('live');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('never reuses a stream whose device has gone', async () => {
    await acquireMic();
    // Unplugged, or taken by another app.
    current.tracks[0]!.readyState = 'ended';

    current = fakeStream();
    await acquireMic();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('stops outright when asked — the page going away', async () => {
    await acquireMic();
    stopMic();

    expect(current.tracks[0]!.readyState).toBe('ended');
    await acquireMic();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('passes a refusal back to the caller', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'));
    await expect(acquireMic()).rejects.toThrow('NotAllowedError');
  });
});
