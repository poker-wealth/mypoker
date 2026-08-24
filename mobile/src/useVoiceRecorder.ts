import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';

/**
 * Press-and-hold voice recording, native side (SAMUEL_V2 tasks 2 + 8).
 *
 * The same feature as the Mini App's `useVoiceRecorder`, and deliberately the
 * same public interface, so `VoiceNote` reads the same on both platforms and a
 * reviewer can diff them. What changed is everything underneath: the web uses
 * MediaRecorder and gets a Blob; here the OS records to a FILE and hands back
 * a uri, so the size check and the base64 both go through the filesystem.
 *
 * ── THE LIMITS ARE NOT COSMETIC ──────────────────────────────────────────────
 * The clip travels on the table's own socket, whose frames are capped at 64KB —
 * and `ws` FAILS THE CONNECTION on an oversized frame rather than rejecting the
 * message. A clip that slipped through would drop the sender out of a live
 * hand. So the recorder stops itself at MAX_MS, asks for a bitrate that lands
 * well inside the budget, and still refuses the result if it came back too big.
 * The server enforces the same ceilings independently; this side exists so the
 * socket is never asked to carry something it would die on.
 *
 * ── WHY m4a/AAC ──────────────────────────────────────────────────────────────
 * `ALLOWED_VOICE_MIME` on the server is a browser-shaped list — webm/opus,
 * ogg/opus, mp4, aac. Of those, MPEG-4 AAC is the one both iOS and Android
 * record natively, and it is already on the list, so native clips are accepted
 * with no server change. Opus is NOT a safe default here: Android can produce
 * it in a webm container but iOS cannot, and a format that works on one
 * platform and silently fails on the other is worse than one that works on
 * both.
 *
 * ── THE BITRATE IS THE WHOLE GAME ────────────────────────────────────────────
 * 24KB for 10 seconds is ~19kbps. The default recording presets are 64–128kbps
 * and would produce a 100KB clip that the server refuses every single time —
 * a feature that appears to work in development and fails for everyone. So the
 * bitrate is pinned at 16kbps mono, which is speech-grade and leaves room for
 * MPEG-4 container overhead.
 *
 * Everything here fails SOFT. A refused microphone, a device that cannot
 * record, an encoder that produced something too large: each ends as a key on
 * the hook's `error`, never as a throw into the table.
 */

/** Matches MAX_VOICE_DURATION_MS on the server. */
export const MAX_MS = 10_000;
/** Matches MIN_VOICE_DURATION_MS — shorter is a fumbled press, not a message. */
export const MIN_MS = 500;
/** Matches MAX_VOICE_BYTES. Raw bytes, not base64 — see base64Bytes() server-side. */
export const MAX_BYTES = 24 * 1024;

/**
 * 16kbps mono AAC: speech-grade, ~2KB/s, so a full ten seconds lands near 20KB
 * — inside MAX_BYTES with room for the container.
 */
const BITS_PER_SECOND = 16_000;
/** 22.05kHz is plenty for speech and keeps the encoder honest at this bitrate. */
const SAMPLE_RATE = 22_050;

/** What the server is told, and one of ALLOWED_VOICE_MIME. */
const MIME = 'audio/mp4';

const RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: SAMPLE_RATE,
  numberOfChannels: 1,
  bitRate: BITS_PER_SECOND,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    // LOW is documented as "good for voice recordings where file size
    // matters", which is exactly the constraint here. Anything higher spends
    // the byte budget on fidelity nobody asked for.
    audioQuality: AudioQuality.LOW,
  },
  web: {},
};

export interface VoiceClip {
  clip: string;
  durationMs: number;
  mime: string;
}

export interface UseVoiceRecorder {
  supported: boolean;
  recording: boolean;
  /** 0..1 through the maximum length, for a progress ring. */
  progress: number;
  error: string | null;
  clearError: () => void;
  start: () => void;
  /** Stop and hand back the clip, or null if it was unusable. */
  stop: () => Promise<VoiceClip | null>;
  cancel: () => void;
}

export function useVoiceRecorder(): UseVoiceRecorder {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);

  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const activeRef = useRef(false);
  /**
   * A clip that FINISHED before anyone asked for it. The ceiling stops the
   * recorder while the finger is still down; without this the finished clip is
   * discarded and holding for the full ten seconds sends nothing at all —
   * release at 9.9s works, 10.0s vanishes. The web hook carries the same fix
   * for the same reason.
   */
  const finishedRef = useRef<Promise<VoiceClip | null> | null>(null);

  const clearTimers = useCallback((): void => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  const teardown = useCallback((): void => {
    clearTimers();
    activeRef.current = false;
    setRecording(false);
    setProgress(0);
  }, [clearTimers]);

  // A recorder left running keeps the microphone open and the OS indicator lit.
  useEffect(() => {
    return () => {
      clearTimers();
      if (activeRef.current) void recorder.stop().catch(() => undefined);
    };
  }, [clearTimers, recorder]);

  /**
   * Turn the finished recording into a clip, or into a reason it is not one.
   * Deletes the file either way — a voice note is not something to leave lying
   * in the cache after it has been sent or refused.
   */
  const collect = useCallback(async (durationMs: number): Promise<VoiceClip | null> => {
    const uri = recorder.uri;
    if (uri === null) {
      setError('recordingFailed');
      return null;
    }

    const file = new File(uri);
    try {
      if (cancelledRef.current) return null;

      if (durationMs < MIN_MS) {
        setError('recordingTooShort');
        return null;
      }

      // Belt and braces: the bitrate should prevent this, but an encoder is
      // free to ignore the hint and the socket is not free to survive an
      // oversized frame. An unreadable size is not a free pass — the whole
      // reason this check exists is that a frame gets no chance to fail
      // gracefully once it hits the socket, so a clip we cannot measure is
      // treated as over budget rather than let through.
      const size = file.size;
      if (size === null || size > MAX_BYTES) {
        setError('recordingTooLong');
        return null;
      }

      const clip = await file.base64();
      return { clip, durationMs: Math.min(durationMs, MAX_MS), mime: MIME };
    } catch {
      setError('recordingFailed');
      return null;
    } finally {
      try {
        if (file.exists) file.delete();
      } catch {
        // A file we could not delete is not a reason to fail the send.
      }
    }
  }, [recorder]);

  const finish = useCallback(async (): Promise<VoiceClip | null> => {
    const durationMs = Date.now() - startedAtRef.current;
    try {
      await recorder.stop();
    } catch {
      teardown();
      setError('recordingFailed');
      return null;
    }
    teardown();
    return collect(durationMs);
  }, [collect, recorder, teardown]);

  const start = useCallback((): void => {
    if (activeRef.current) return; // already holding

    cancelledRef.current = false;
    finishedRef.current = null;
    setError(null);

    void (async () => {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          // Denied is an ordinary answer, not a failure of the table.
          setError('microphoneDenied');
          return;
        }

        // The press may have ended while the permission prompt was up.
        if (cancelledRef.current) return;

        // Without this, iOS records at a whisper when the app has been playing
        // audio, and Android may route to the earpiece.
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

        await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
        if (cancelledRef.current) return;

        recorder.record();
        activeRef.current = true;
        startedAtRef.current = Date.now();
        setRecording(true);

        tickRef.current = setInterval(() => {
          setProgress(Math.min(1, (Date.now() - startedAtRef.current) / MAX_MS));
        }, 100);

        // Hard stop at the ceiling even if the finger never lifts. The result
        // is parked for the eventual release rather than thrown away.
        autoStopRef.current = setTimeout(() => {
          if (activeRef.current) finishedRef.current = finish();
        }, MAX_MS);
      } catch {
        // NOT 'recordingUnsupported' — that string says "this browser", which
        // is a lie on a phone. Failing to prepare the recorder here means the
        // device would not give us one.
        setError('recordingUnavailable');
        teardown();
      }
    })();
  }, [finish, recorder, teardown]);

  const stop = useCallback((): Promise<VoiceClip | null> => {
    // A clip that hit the ceiling finished while the finger was still down —
    // this release claims it.
    if (finishedRef.current) {
      const done = finishedRef.current;
      finishedRef.current = null;
      return done;
    }
    if (!activeRef.current) {
      // Released before recording ever began (permission prompt, or a tap
      // rather than a hold). Make sure a pending start cannot outlive it.
      cancelledRef.current = true;
      teardown();
      return Promise.resolve(null);
    }
    return finish();
  }, [finish, teardown]);

  const cancel = useCallback((): void => {
    cancelledRef.current = true;
    finishedRef.current = null;
    if (activeRef.current) void finish();
    else teardown();
  }, [finish, teardown]);

  const clearError = useCallback(() => setError(null), []);

  return {
    // Recording is a native capability here, not a browser feature to detect.
    // A device without a microphone surfaces as a denied permission instead.
    supported: true,
    recording,
    progress,
    error,
    clearError,
    start,
    stop,
    cancel,
  };
}
