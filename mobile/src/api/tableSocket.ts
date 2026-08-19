import type { TableCommand, TableSnapshot } from '../lib/liveTable';
import {
  deriveSessionKey,
  generateEphemeralKeyPair,
  signMessage,
  verifyMessage,
} from './transportCrypto';

/**
 * The client half of the game-server's secure transport, for React Native.
 *
 * Same protocol as `frontend/src/api/tableSocket.ts`:
 *   1. server sends `server_hello` with an ephemeral X25519 public key
 *   2. we reply `client_hello` with ours and the session token
 *   3. both sides derive the same key (ECDH → HKDF-SHA256, info `fairplay-ws-v1`)
 *   4. everything after is `{ seq, payload, mac }`, HMAC-SHA256 over `seq.payload`
 *
 * Two differences from the web version, both because there is no WebCrypto here:
 *
 *   - the crypto is synchronous (@noble, not `crypto.subtle`), so the web client's promise chain
 *     for ordering inbound frames is unnecessary — frames are handled in arrival order already;
 *   - key derivation cannot fail on "this browser is too old", so that branch is gone.
 *
 * The sequence number is monotonic, so a replayed or reordered frame is dropped, and every inbound
 * frame's MAC is verified before a snapshot reaches the table.
 */

export type SocketStatus = 'connecting' | 'ready' | 'reconnecting' | 'closed' | 'error';

export interface TableSocketHandlers {
  onSnapshot: (snapshot: TableSnapshot) => void;
  onStatus: (status: SocketStatus) => void;
  /** A rejected command ("not your turn", "seat taken") — show it, don't crash on it. */
  onError: (message: string) => void;
  /** The table refused the token. It is dead; drop it rather than retrying forever. */
  onUnauthorized?: () => void;
}

const MAX_BACKOFF_MS = 8_000;

/** Close reasons that will never heal by reconnecting. */
const FATAL: Record<string, string> = {
  unauthorized: 'The table rejected your session. Sign in again.',
  handshake_timeout: 'The table did not answer the handshake in time.',
  rate_limited: 'Too many messages — the table dropped the connection.',
};

export class TableSocket {
  private ws: WebSocket | null = null;
  private key: Uint8Array | null = null;
  private outboundSeq = 0;
  private lastInboundSeq = 0;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closedByUs = false;
  /**
   * Set once `close()` is called, after which this instance says nothing. A screen that unmounts
   * and remounts creates a second socket, and a late event from the discarded one must not stamp
   * its status over the live one.
   */
  private dead = false;
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly tableId: string,
    private readonly handlers: TableSocketHandlers,
  ) {}

  private emitStatus(s: SocketStatus): void {
    if (!this.dead) this.handlers.onStatus(s);
  }
  private emitError(m: string): void {
    if (!this.dead) this.handlers.onError(m);
  }

  connect(): void {
    this.closedByUs = false;
    this.emitStatus(this.retries === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.key = null;
    this.outboundSeq = 0;
    this.lastInboundSeq = 0;

    ws.onmessage = (event: WebSocketMessageEvent): void => {
      try {
        this.onMessage(String(event.data));
      } catch (err) {
        // A handshake that throws must not leave the screen on "connecting" with no explanation.
        const message = err instanceof Error ? err.message : String(err);
        console.error('[table socket]', err);
        this.emitStatus('error');
        this.emitError(`Table connection failed: ${message}`);
        this.closedByUs = true; // a broken handshake will not fix itself by retrying
        ws.close();
      }
    };

    ws.onclose = (event: WebSocketCloseEvent): void => {
      if (this.ws === ws) this.ws = null;
      if (this.closedByUs) return this.emitStatus('closed');

      const explanation = event.reason ? FATAL[event.reason] : undefined;
      if (explanation) {
        this.closedByUs = true;
        this.emitStatus('error');
        this.emitError(explanation);
        if (event.reason === 'unauthorized' && !this.dead) this.handlers.onUnauthorized?.();
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = (): void => {
      // `onclose` always follows; reconnection is handled there.
    };
  }

  /** Send a table command. Ignored until the handshake completes. */
  send(command: TableCommand): void {
    this.sendInner({ type: 'action', roomId: this.tableId, action: command });
  }

  on(event: string, cb: (data: unknown) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: string, cb: (data: unknown) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  close(): void {
    this.closedByUs = true;
    this.dead = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;

    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      this.sendInner({ type: 'leave', roomId: this.tableId }, ws);
      ws.close();
    } else {
      ws?.close();
    }
    // No status on the way out: whoever closed this has either unmounted or already opened a
    // replacement, and a parting "closed" would only overwrite the new one.
  }

  // ── Wire handling ───────────────────────────────────────────────────────────

  private onMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    // Handshake frames are plaintext — there is no shared key yet.
    const frame = parsed as { t?: string; serverPublicKey?: string };
    if (frame.t === 'server_hello' && frame.serverPublicKey) {
      const pair = generateEphemeralKeyPair();
      this.key = deriveSessionKey(pair.privateKey, frame.serverPublicKey);
      this.raw({ t: 'client_hello', clientPublicKey: pair.publicKeyB64, token: this.token });
      return;
    }
    if (frame.t === 'ready') {
      this.retries = 0;
      this.emitStatus('ready');
      this.sendInner({ type: 'join', roomId: this.tableId });
      return;
    }

    const envelope = parsed as { seq: number; payload: string; mac: string };
    if (!this.key || typeof envelope.payload !== 'string' || typeof envelope.mac !== 'string') {
      return;
    }
    if (envelope.seq <= this.lastInboundSeq) return; // replayed or reordered — drop it
    if (!verifyMessage(this.key, envelope.seq, envelope.payload, envelope.mac)) {
      this.emitError('Dropped a table message that failed its signature check.');
      return;
    }
    this.lastInboundSeq = envelope.seq;

    const message = JSON.parse(envelope.payload) as
      | { type: 'state'; roomId: string; state: TableSnapshot }
      | { type: 'event'; roomId: string; event: string; data: unknown }
      | { type: 'error'; message: string };

    if (message.type === 'state') {
      if (!this.dead) this.handlers.onSnapshot(message.state);
    } else if (message.type === 'event') {
      const set = this.listeners.get(message.event);
      if (set) for (const cb of set) cb(message.data);
    } else if (message.type === 'error') {
      this.emitError(message.message);
    }
  }

  private sendInner(message: unknown, socket?: WebSocket): void {
    const ws = socket ?? this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.key) return;
    const payload = JSON.stringify(message);
    const seq = ++this.outboundSeq;
    ws.send(JSON.stringify({ seq, payload, mac: signMessage(this.key, seq, payload) }));
  }

  private raw(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    this.emitStatus('reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.retries);
    this.retries += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
}
