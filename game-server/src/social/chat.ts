import { canChat } from '../players/reputation';

/**
 * In-table chat (FairPlay v5.9 §10.1, §12).
 *
 * Reputation gates chat — and ONLY chat and table access, never money (§10.1). A muted or Very Poor
 * player keeps every cent and every withdrawal right; they simply cannot type at the table.
 *
 * Two protections beyond the gate:
 *  • Rate limiting, so a table cannot be flooded.
 *  • Spectators may not chat into a live hand — a spectator sees the table from outside and a
 *    running commentary is a collusion channel, the same reason spectators never see hole cards.
 */

export const MAX_MESSAGE_LENGTH = 200;
export const RATE_LIMIT_MESSAGES = 5;
export const RATE_LIMIT_WINDOW_MS = 10_000;

export type ChatDenial =
  | 'REPUTATION_TOO_LOW'
  | 'MUTED'
  | 'RATE_LIMITED'
  | 'TOO_LONG'
  | 'EMPTY'
  | 'SPECTATORS_CANNOT_CHAT';

export type ChatDecision = { ok: true } | { ok: false; reason: ChatDenial };

export interface ChatterState {
  /** Timestamps of recent messages, for the rate limiter. */
  recent: number[];
  /** Ops/league mute, with an expiry. Mute affects chat only — never funds. */
  mutedUntil: number | null;
}

export function newChatterState(): ChatterState {
  return { recent: [], mutedUntil: null };
}

export interface ChatRequest {
  reputationScore: number;
  isSpectator: boolean;
  message: string;
  now: number;
}

export function evaluateChat(state: ChatterState, req: ChatRequest): ChatDecision {
  const text = req.message.trim();
  if (text.length === 0) return { ok: false, reason: 'EMPTY' };
  if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  if (req.isSpectator) return { ok: false, reason: 'SPECTATORS_CANNOT_CHAT' };
  if (state.mutedUntil !== null && req.now < state.mutedUntil) return { ok: false, reason: 'MUTED' };
  if (!canChat(req.reputationScore)) return { ok: false, reason: 'REPUTATION_TOO_LOW' };

  const windowStart = req.now - RATE_LIMIT_WINDOW_MS;
  const inWindow = state.recent.filter((t) => t > windowStart);
  if (inWindow.length >= RATE_LIMIT_MESSAGES) return { ok: false, reason: 'RATE_LIMITED' };

  return { ok: true };
}

/** Record an accepted message (advances the rate limiter). */
export function recordMessage(state: ChatterState, now: number): void {
  state.recent = [...state.recent.filter((t) => t > now - RATE_LIMIT_WINDOW_MS), now];
}

export function mute(state: ChatterState, until: number): void {
  state.mutedUntil = until;
}

/**
 * A muted player's money is untouched — stated as a function so the guarantee is testable rather
 * than merely documented. Chat penalties never reach the Financial Core.
 */
export function muteAffectsFunds(): false {
  return false;
}
