import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
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
  /**
   * Whether this player may hold a socket AT ALL — asked after the token
   * proves who they are, before a session exists.
   *
   * Separate from `verifyToken` on purpose. That one is pure crypto: signature
   * and expiry, no I/O, and the standalone table server runs it with no
   * database behind it. This is POLICY, it needs a read, and it is optional so
   * a DB-less deployment is not forced to invent one.
   *
   * It exists because a JWT is a snapshot. Suspension happens after the token
   * is minted, and the felt only ever checked the signature — so a banned
   * player kept playing until their token expired and could open a fresh
   * socket the entire time. Every suspension test mounts an HTTP route and
   * never opens a socket, which is why the suite stayed green over it.
   */
  authorizeSession?: (playerId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Handle a validated inbound message from an established client. */
  onInbound: (ctx: ClientContext, msg: Inbound) => void | Promise<void>;
  /** Called when a client disconnects (cleanup rooms, etc.). */
  onClose?: (ctx: ClientContext) => void;
  handshakeTimeoutMs?: number;
  /**
   * Optional observer for connection lifecycle, including the handshakes that never complete.
   * Without it, a client that fails to authenticate is indistinguishable from one that never
   * arrived — which is exactly the case you need to tell apart when a table "won't connect".
   */
  onEvent?: (event: { type: 'open' | 'ready' | 'closed'; playerId?: string; reason?: string }) => void;
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

  /**
   * Share an existing HTTP server instead of taking a port of its own, so the REST API and the game
   * socket live behind one origin (one URL to configure, one TLS certificate, no CORS dance).
   */
  attachTo(server: HttpServer, path?: string): void {
    this.wss = new WebSocketServer({
      server,
      ...(path ? { path } : {}),
      maxPayload: MAX_MESSAGE_BYTES,
    });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
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
    const report = this.config.onEvent;
    const close = (reason?: string): void => {
      notifyClose();
      report?.({ type: 'closed', ...(session ? { playerId: session.playerId } : {}), reason: reason ?? 'closed' });
      ws.close(4000, reason ?? 'closed');
    };

    // Step 1: server hello (plaintext — no shared key yet).
    report?.({ type: 'open' });
    sendRaw({ t: 'server_hello', serverPublicKey: publicKeyB64, connectionId });

    const handshakeTimer = setTimeout(() => {
      if (!session) close('handshake_timeout');
    }, this.config.handshakeTimeoutMs ?? 5000);

    /**
     * Everything after the two checks: derive the shared key, open the session.
     *
     * Split out so the authorized and unauthorized-but-permitted paths cannot
     * drift — `authorizeSession` resolves asynchronously, and duplicating this
     * body into the callback is how one of the two copies eventually forgets to
     * clear the handshake timer or start the rate limiter.
     */
    const finishHandshake = (playerId: string, clientPublicKey: string): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const key = deriveSessionKey(privateKey, clientPublicKey);
      session = new Session(playerId, key);
      limiter = new RateLimiter();
      clearTimeout(handshakeTimer);
      ctx = {
        session,
        send: (msg): void => sendRaw(session!.signOutbound(JSON.stringify(msg))),
        close,
      };
      report?.({ type: 'ready', playerId });
      sendRaw({ t: 'ready' });
    };

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
        // Policy, after identity. `void`-ed because `ws.on('message')` cannot
        // await; the handshake is simply not finished until it resolves. That
        // is safe: `session` stays undefined in the gap, so any frame arriving
        // meanwhile re-enters THIS branch and is rejected as a bad handshake
        // rather than processed unauthorized.
        const authorize = this.config.authorizeSession;
        if (authorize) {
          const clientPublicKey = hello.data.clientPublicKey;
          void authorize(playerId)
            .then((verdict) => {
              if (!verdict.ok) return close(verdict.reason);
              finishHandshake(playerId, clientPublicKey);
            })
            .catch(() => {
              // A failed lookup must not open the door. Refusing a legitimate
              // player on a database blip is recoverable — they reconnect.
              // Seating a banned one is not.
              close('unauthorized');
            });
          return;
        }

        finishHandshake(playerId, hello.data.clientPublicKey);
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
      if (!notifiedClose) {
        report?.({
          type: 'closed',
          ...(session ? { playerId: session.playerId } : {}),
          reason: session ? 'client_left' : 'gave_up_before_handshake',
        });
      }
      notifyClose();
    });
  }
}
