import { evaluateChat, recordMessage, type ChatterState, type ChatDenial } from './chat';

/**
 * Voice notes at the table — an ASYNC voice message, not a call.
 *
 * Press and hold to record a short clip, release to send; everyone else taps to
 * play it. There is no live audio stream anywhere in this design: no Agora, no
 * WebRTC, no media server, and nothing to keep open between hands.
 *
 * A voice note is a chat message that happens to be audio, so it is governed by
 * exactly the same rules — reputation gate, mute, spectator ban, rate limit
 * (§10.1, §12). Reusing `evaluateChat` rather than re-deriving those rules is
 * deliberate: a second copy is a second thing to forget to update, and the day
 * someone tightens the text rules a divergent voice path becomes the way around
 * them. A muted player must not be able to simply say it out loud instead.
 *
 * ── WHY THE CAPS ARE WHAT THEY ARE ────────────────────────────────────────────
 * The clip rides the existing table socket, whose frames are capped at
 * MAX_MESSAGE_BYTES (64KB) by `ws`'s own `maxPayload`. That limit is not a
 * polite rejection: `ws` fails the connection with a 1009 when a frame exceeds
 * it, which would drop the sender out of a live hand. An oversized voice note
 * must therefore be impossible to put on the wire, not merely refused on
 * arrival — which is why the byte cap is enforced client-side before sending
 * AND here on receipt, and why it sits well below the frame limit:
 *
 *   24KB raw clip  ->  ~32KB base64  ->  ~33KB on the wire once wrapped in the
 *   envelope (payload is JSON-encoded inside another JSON object).
 *
 * That is roughly half the frame budget, so no combination of envelope
 * overhead, MAC, and sequence numbering can push a legal clip over the edge.
 * At the 16kbps mono Opus the client records, 24KB is about ten seconds of
 * speech — which is also as long as anyone at a poker table wants to listen to.
 */

/** Longest clip we accept. Also what the recorder stops itself at. */
export const MAX_VOICE_DURATION_MS = 10_000;
/** Shorter than this is a fumbled press, not a message. */
export const MIN_VOICE_DURATION_MS = 500;
/** Decoded size ceiling — see the frame-budget note above. */
export const MAX_VOICE_BYTES = 24 * 1024;

/**
 * Containers we accept. Opus in WebM is what Chrome/Firefox/Android produce;
 * mp4/aac is what iOS Safari produces, and iOS is half the audience of a
 * Telegram Mini App. Anything else is refused rather than relayed to every
 * client at the table to see what happens.
 */
export const ALLOWED_VOICE_MIME = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/aac',
] as const;

export type VoiceDenial = ChatDenial | 'TOO_LONG_AUDIO' | 'TOO_SHORT_AUDIO' | 'TOO_LARGE' | 'BAD_FORMAT';

export type VoiceDecision = { ok: true } | { ok: false; reason: VoiceDenial };

export interface VoiceRequest {
  reputationScore: number;
  isSpectator: boolean;
  durationMs: number;
  /** Base64 payload exactly as it arrived. */
  clip: string;
  mime: string;
  now: number;
}

/** Decoded byte length of a base64 string, without allocating the buffer. */
export function base64Bytes(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (b64.charCodeAt(len - 1) === 61) padding++; // '='
  if (len > 1 && b64.charCodeAt(len - 2) === 61) padding++;
  return Math.floor((len * 3) / 4) - padding;
}

/**
 * Decide whether a voice note may be sent. The audio-specific caps are checked
 * FIRST and the shared chat rules second, so an oversized clip is refused for
 * being oversized rather than consuming the sender's rate-limit budget on the
 * way to the same answer.
 */
export function evaluateVoice(state: ChatterState, req: VoiceRequest): VoiceDecision {
  if (!ALLOWED_VOICE_MIME.includes(req.mime as (typeof ALLOWED_VOICE_MIME)[number])) {
    return { ok: false, reason: 'BAD_FORMAT' };
  }
  if (!Number.isFinite(req.durationMs) || req.durationMs < MIN_VOICE_DURATION_MS) {
    return { ok: false, reason: 'TOO_SHORT_AUDIO' };
  }
  if (req.durationMs > MAX_VOICE_DURATION_MS) return { ok: false, reason: 'TOO_LONG_AUDIO' };
  if (base64Bytes(req.clip) > MAX_VOICE_BYTES) return { ok: false, reason: 'TOO_LARGE' };

  // The shared rules. `message` stands in for the clip: a voice note is a chat
  // message, and it must clear every gate a typed one would. The placeholder is
  // non-empty and short so it can only ever fail on a rule that genuinely
  // applies to audio — never on EMPTY or TOO_LONG, which describe text.
  const shared = evaluateChat(state, {
    reputationScore: req.reputationScore,
    isSpectator: req.isSpectator,
    message: '[voice]',
    now: req.now,
  });
  return shared.ok ? { ok: true } : shared;
}

/** Record an accepted voice note. Voice and text share one rate-limit budget. */
export const recordVoice = recordMessage;
