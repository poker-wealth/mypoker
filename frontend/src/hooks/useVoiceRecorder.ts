import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Press-and-hold voice recording for the table (SAMUEL_V2 task 2).
 *
 * Records a short clip with MediaRecorder and hands back base64. There is no
 * streaming and no peer connection: you hold, you release, a file is sent. That
 * is the whole feature, and it is why it needs no media server.
 *
 * ── THE LIMITS ARE NOT COSMETIC ───────────────────────────────────────────────
 * The clip travels on the table's own socket, whose frames are capped at 64KB —
 * and `ws` FAILS THE CONNECTION on an oversized frame rather than rejecting the
 * message. A clip that slipped through would therefore drop the sender out of a
 * live hand. So the recorder stops itself at MAX_MS, asks the encoder for a
 * bitrate that lands well inside the budget, and still refuses the result if it
 * came back too big. The server enforces the same ceilings independently — this
 * side exists so the socket is never asked to carry something it would die on.
 *
 * Everything here fails SOFT. A refused microphone, a browser with no
 * MediaRecorder, an encoder that produced something too large: each ends as a
 * message on the hook's `error`, never as a throw into the table.
 */

/** Matches MAX_VOICE_DURATION_MS on the server. */
export const MAX_MS = 10_000;
/** Matches MIN_VOICE_DURATION_MS — shorter is a fumbled press, not a message. */
export const MIN_MS = 500;
/** Matches MAX_VOICE_BYTES. */
export const MAX_BYTES = 24 * 1024;
/**
 * 16kbps mono Opus: speech-grade, and ~2KB/s so a full ten seconds lands near
 * 20KB — inside MAX_BYTES with room for container overhead.
 */
const BITS_PER_SECOND = 16_000;

/** Ordered by preference; the first the browser admits to supporting wins. */
const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4', // iOS Safari
];

export interface VoiceClip {
  clip: string;
  durationMs: number;
  mime: string;
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

/** Base64 without the data: prefix, via FileReader (handles large blobs safely). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('could not read the recording'));
    reader.onload = () => {
      const s = String(reader.result);
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.readAsDataURL(blob);
  });
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
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  // stop() resolves from the recorder's own 'stop' event, which may also be
  // fired by the auto-stop timer. Parking the resolver here means both routes
  // settle the same promise instead of racing two of them.
  const resolveRef = useRef<((c: VoiceClip | null) => void) | null>(null);
  /**
   * A clip that FINISHED before anyone asked for it. The 10-second ceiling
   * stops the recorder while the finger is still down; the old code found no
   * parked resolver in onstop and threw the blob away, so holding for the full
   * ten seconds sent nothing at all — release at 9.9s worked, 10.0s vanished.
   * Now the finished clip (a promise: encoding is async) waits here and the
   * eventual finger-lift claims it.
   */
  const finishedRef = useRef<Promise<VoiceClip | null> | null>(null);

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && pickMimeType() !== null;

  /** Release the microphone and every timer. Safe to call twice. */
  const teardown = useCallback((): void => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    // Stopping the tracks is what turns the browser's recording indicator off.
    // Leaving them live would keep a microphone open on someone's phone.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setProgress(0);
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback((): void => {
    if (recorderRef.current) return; // already holding
    const mime = pickMimeType();
    if (!mime) { setError('recordingUnsupported'); return; }

    cancelledRef.current = false;
    finishedRef.current = null;
    setError(null);

    void navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        // The press may have ended while the permission prompt was up.
        if (cancelledRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }

        streamRef.current = stream;
        const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: BITS_PER_SECOND });
        recorderRef.current = rec;
        chunksRef.current = [];
        startedAtRef.current = Date.now();

        rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        rec.onstop = () => {
          const durationMs = Date.now() - startedAtRef.current;
          const blob = new Blob(chunksRef.current, { type: mime });
          const resolve = resolveRef.current;
          resolveRef.current = null;
          teardown();

          if (cancelledRef.current) { resolve?.(null); return; }

          const settle = (): Promise<VoiceClip | null> => {
            if (durationMs < MIN_MS) { setError('recordingTooShort'); return Promise.resolve(null); }
            if (blob.size > MAX_BYTES) {
              // Belt and braces: the bitrate should prevent this, but a browser
              // is free to ignore the hint, and the socket is not free to
              // survive an oversized frame.
              setError('recordingTooLong');
              return Promise.resolve(null);
            }
            return blobToBase64(blob)
              .then((clip) => ({ clip, durationMs: Math.min(durationMs, MAX_MS), mime }))
              .catch(() => { setError('recordingFailed'); return null; });
          };

          const result = settle();
          if (resolve) void result.then(resolve);
          // Auto-stop at the ceiling: nobody is waiting yet. Park the finished
          // clip for the finger-lift instead of discarding ten seconds of voice.
          else finishedRef.current = result;
        };

        rec.start();
        setRecording(true);

        tickRef.current = setInterval(() => {
          setProgress(Math.min(1, (Date.now() - startedAtRef.current) / MAX_MS));
        }, 100);
        // Hard stop at the ceiling even if the finger never lifts.
        autoStopRef.current = setTimeout(() => {
          if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        }, MAX_MS);
      })
      .catch(() => {
        // Denied, or no microphone. Both are ordinary answers, not failures of
        // the table — say so and carry on.
        setError('microphoneDenied');
        teardown();
      });
  }, [teardown]);

  const stop = useCallback((): Promise<VoiceClip | null> => {
    // A clip that hit the 10s ceiling finished while the finger was still
    // down — this release claims it.
    if (finishedRef.current) {
      const done = finishedRef.current;
      finishedRef.current = null;
      return done;
    }
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'recording') {
      // Released before the recorder ever started (permission prompt, or a tap
      // rather than a hold). Make sure a pending start cannot outlive it.
      cancelledRef.current = true;
      teardown();
      return Promise.resolve(null);
    }
    return new Promise<VoiceClip | null>((resolve) => {
      resolveRef.current = resolve;
      rec.stop();
    });
  }, [teardown]);

  const cancel = useCallback((): void => {
    cancelledRef.current = true;
    finishedRef.current = null;
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') rec.stop();
    else teardown();
  }, [teardown]);

  const clearError = useCallback(() => setError(null), []);

  return { supported, recording, progress, error, clearError, start, stop, cancel };
}
