import { z } from 'zod';

/** FairPlay M2: max WebSocket message size. */
export const MAX_MESSAGE_BYTES = 64 * 1024;

// ── Handshake (plaintext JSON, before the session key exists) ──────────────────────────────────
export const serverHelloSchema = z.object({
  t: z.literal('server_hello'),
  serverPublicKey: z.string(),
  connectionId: z.string(),
});
export type ServerHello = z.infer<typeof serverHelloSchema>;

export const clientHelloSchema = z.object({
  t: z.literal('client_hello'),
  clientPublicKey: z.string(),
  token: z.string(),
});
export type ClientHello = z.infer<typeof clientHelloSchema>;

export const readySchema = z.object({ t: z.literal('ready') });

// ── Authenticated envelope (post-handshake): HMAC over (seq ‖ payload) ──────────────────────────
export const envelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  payload: z.string(), // JSON-encoded inner message
  mac: z.string(),
});
export type Envelope = z.infer<typeof envelopeSchema>;

// ── Inner messages (client → server) ────────────────────────────────────────────────────────────
export const inboundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), roomId: z.string().min(1) }),
  z.object({ type: z.literal('action'), roomId: z.string().min(1), action: z.unknown() }),
  z.object({ type: z.literal('leave'), roomId: z.string().min(1) }),
]);
export type Inbound = z.infer<typeof inboundSchema>;

// ── Outbound messages (server → client) ─────────────────────────────────────────────────────────
export type Outbound =
  | { type: 'state'; roomId: string; state: unknown }
  | { type: 'event'; roomId: string; event: string; data: unknown }
  | { type: 'error'; message: string };
