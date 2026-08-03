import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { generateEphemeralKeyPair, deriveSessionKey } from './crypto';
import { Session } from './session';
import { RateLimiter } from './rate-limiter';
import {
  clientHelloSchema,
  envelopeSchema,
  inboundSchema,
  MAX_MESSAGE_BYTES,
  type Inbound,
  type Outbound,
} from './protocol';

/**
 * GameSocketServer — secure real-time transport (FairPlay M2).
 *
 * Per connection: ECDH handshake → Session (HMAC + monotonic sequence) → rate-limited, size-capped
 * message dispatch. Three security failures close the connection. The game logic is injected via
 * `onInbound` — the transport knows nothing about poker, only about secure framed messages.
 */

export interface ClientContext {
  readonly session: Session;
  send(msg: Outbound): void;
  close(reason?: string): void;
}

export interface GameSocketServerConfig {
  /** Verify a player's auth token; return their id or throw. */
  verifyToken: (token: string) => { playerId: string };
  /** Handle a validated inbound message from an established client. */
  onInbound: (ctx: ClientContext, msg: Inbound) => void | Promise<void>;
  /** Called when a client disconnects (cleanup rooms, etc.). */
  onClose?: (ctx: ClientContext) => void;
  handshakeTimeoutMs?: number;
}

export class GameSocketServer {
  private wss: WebSocketServer | undefined;

  constructor(private readonly config: GameSocketServerConfig) {}

  /** Start listening. `port = 0` picks an ephemeral port; the chosen port is returned. */
  async listen(port = 0): Promise<number> {
    this.wss = new WebSocketServer({ port, maxPayload: MAX_MESSAGE_BYTES });
    await new Promise<void>((resolve) => this.wss!.once('listening', resolve));
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    return (this.wss.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    if (!this.wss) return;
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>((resolve, reject) =>
      this.wss!.close((err) => (err ? reject(err) : resolve())),
    );
    this.wss = undefined;
  }

  private handleConnection(ws: WebSocket): void {
    const { privateKey, publicKeyB64 } = generateEphemeralKeyPair();
    const connectionId = randomUUID();
    let session: Session | undefined;
    let limiter: RateLimiter | undefined;
    let ctx: ClientContext | undefined;
    let notifiedClose = false;

    const notifyClose = (): void => {
      if (notifiedClose) return;
      notifiedClose = true;
      if (ctx && this.config.onClose) this.config.onClose(ctx);
    };
    const sendRaw = (obj: unknown): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };
    const close = (reason?: string): void => {
      notifyClose();
      ws.close(4000, reason ?? 'closed');
    };

    // Step 1: server hello (plaintext — no shared key yet).
    sendRaw({ t: 'server_hello', serverPublicKey: publicKeyB64, connectionId });

    const handshakeTimer = setTimeout(() => {
      if (!session) close('handshake_timeout');
    }, this.config.handshakeTimeoutMs ?? 5000);

    ws.on('message', (data: Buffer): void => {
      if (data.length > MAX_MESSAGE_BYTES) return close('message_too_large');

      // ── Handshake phase ──
      if (!session) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          return close('bad_handshake');
        }
        const hello = clientHelloSchema.safeParse(parsed);
        if (!hello.success) return close('bad_handshake');
        let playerId: string;
        try {
          playerId = this.config.verifyToken(hello.data.token).playerId;
        } catch {
          return close('unauthorized');
        }
        const key = deriveSessionKey(privateKey, hello.data.clientPublicKey);
        session = new Session(playerId, key);
        limiter = new RateLimiter();
        clearTimeout(handshakeTimer);
        ctx = {
          session,
          send: (msg): void => sendRaw(session!.signOutbound(JSON.stringify(msg))),
          close,
        };
        sendRaw({ t: 'ready' });
        return;
      }

      // ── Established phase ──
      if (limiter && !limiter.allow()) return close('rate_limited');

      let env: unknown;
      try {
        env = JSON.parse(data.toString());
      } catch {
        return close('bad_envelope');
      }
      const parsedEnv = envelopeSchema.safeParse(env);
      if (!parsedEnv.success) return close('bad_envelope');

      const result = session.verifyInbound(
        parsedEnv.data.seq,
        parsedEnv.data.payload,
        parsedEnv.data.mac,
      );
      if (!result.ok) {
        if (result.disconnect) return close(`security:${result.reason}`);
        return ctx!.send({ type: 'error', message: `rejected:${result.reason}` });
      }

      let inner: unknown;
      try {
        inner = JSON.parse(result.payload!);
      } catch {
        return ctx!.send({ type: 'error', message: 'bad_payload' });
      }
      const msg = inboundSchema.safeParse(inner);
      if (!msg.success) return ctx!.send({ type: 'error', message: 'bad_message' });

      void Promise.resolve(this.config.onInbound(ctx!, msg.data)).catch((err: unknown) => {
        ctx!.send({ type: 'error', message: err instanceof Error ? err.message : 'error' });
      });
    });

    ws.on('close', () => {
      clearTimeout(handshakeTimer);
      notifyClose();
    });
  }
}
