/**
 * ONE MICROPHONE, REUSED ACROSS RECORDINGS.
 *
 * The voice recorder used to call `getUserMedia` on every press and stop the
 * tracks on every release. In an ordinary browser that is tidy: permission is
 * remembered per origin, so only the first request prompts. Inside TELEGRAM'S
 * WEBVIEW it is not — the host app raises its own permission card for each
 * request, so a player holding the mic button was asked "allow mypoker to use
 * your microphone?" again and again however many times they allowed it (owner,
 * 20 Sep 2026: "even after granting it, the permission request keeps popping
 * up").
 *
 * So the granted stream is kept. Between recordings its tracks are DISABLED —
 * a disabled track captures silence, so nothing is heard while nobody is
 * recording — and the device is handed back after `MIC_IDLE_MS` with no
 * recording, or at once when the page goes away.
 *
 * The trade-off is deliberate: the browser's recording indicator may stay lit
 * for that minute. That is visible and bounded, where a permission card on
 * every press is neither.
 *
 * Module state, not React state: the microphone is a device, there is one of
 * it, and two components asking at once must not open it twice.
 */

/** How long a granted microphone is held after the last recording. */
export const MIC_IDLE_MS = 60_000;

let sharedStream: MediaStream | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

/** A stream is only reusable while the device is still attached to it. */
function isLive(stream: MediaStream | null): stream is MediaStream {
  return !!stream && stream.getAudioTracks().some((t) => t.readyState === 'live');
}

/** Hand the device back and forget the stream. Safe to call twice. */
export function stopMic(): void {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  sharedStream?.getTracks().forEach((t) => t.stop());
  sharedStream = null;
}

/** Mute now; release the device if nothing records again within MIC_IDLE_MS. */
export function parkMic(): void {
  if (!isLive(sharedStream)) {
    stopMic();
    return;
  }
  sharedStream.getAudioTracks().forEach((t) => (t.enabled = false));
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(stopMic, MIC_IDLE_MS);
}

/**
 * The stream we already hold, or a new one — which is the call that may prompt.
 *
 * Rejects exactly as `getUserMedia` does, so a refusal stays the caller's
 * ordinary "microphone denied" path.
 */
export async function acquireMic(): Promise<MediaStream> {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (isLive(sharedStream)) {
    sharedStream.getAudioTracks().forEach((t) => (t.enabled = true));
    return sharedStream;
  }
  // A dead stream (device unplugged, track ended) must not be reused: its
  // tracks would record silence and the player would send an empty clip.
  stopMic();
  sharedStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  return sharedStream;
}
