import type { TableCommand, TableSnapshot } from '@/lib/liveTable';

/**
 * The client half of the game-server's secure transport.
 *
 * Handshake (matches `game-server/src/transport/`):
 *   1. server sends `server_hello` with an ephemeral X25519 public key
 *   2. we generate our own ephemeral pair and reply `client_hello` with our key + session token
 *   3. both sides derive the same session key (ECDH → HKDF-SHA256, info `fairplay-ws-v1`)
 *   4. every message after that is `{ seq, payload, mac }`, HMAC-SHA256 over `seq.payload`
 *
 * The sequence number is monotonic, so a replayed or reordered frame is rejected by the server —
 * and we verify the MAC on everything coming back, so a tampered snapshot never reaches the table.
 * Ephemeral keys mean a stolen key later can't unpick a hand played today.
 */

export type SocketStatus = 'connecting' | 'ready' | 'reconnecting' | 'closed' | 'error';

export interface TableSocketHandlers {
  onSnapshot: (snapshot: TableSnapshot) => void;
  onStatus: (status: SocketStatus) => void;
  /** A rejected command ("not your turn", "seat taken") — show it, don't crash on it. */
  onError: (message: string) => void;
  /**
   * The table refused the session token. Mirrors what a 401 does on the REST side: the token is
   * dead, so drop it rather than retrying with it forever.
   */
  onUnauthorized?: () => void;
}

const HKDF_INFO = 'fairplay-ws-v1';
const MAX_BACKOFF_MS = 8_000;

interface Envelope {
  seq: number;
  payload: string;
  mac: string;
}

export class TableSocket {
  private ws: WebSocket | null = null;
  /** Every status/error/snapshot leaves through here, so a dead socket can be silenced in one place. */
  private readonly emit = {
    status: (s: SocketStatus): void => {
      if (!this.dead) this.handlers.onStatus(s);
    },
    error: (m: string): void => {
      if (!this.dead) this.handlers.onError(m);
    },
    snapshot: (s: TableSnapshot): void => {
      if (!this.dead) this.handlers.onSnapshot(s);
    },
  };
  private key: CryptoKey | null = null;
  private outboundSeq = 0;
  private lastInboundSeq = 0;
  /** Inbound frames are verified asynchronously — chain them so snapshots apply in order. */
  private inbound: Promise<void> = Promise.resolve();
  private retries = 0;
  private retryTimer: number | undefined;
  private closedByUs = false;
  /**
   * Set once `close()` is called. A discarded socket must go quiet: React's dev double-mount
   * creates one, throws it away and creates another, and a late `onclose` from the dead one used to
   * stamp "closed" over the live one's status.
   */
  private dead = false;
  private eventListeners: Map<string, Set<(data: unknown) => void>> = new Map();

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly tableId: string,
    private readonly handlers: TableSocketHandlers,
  ) {}

  connect(): void {
    if (!globalThis.crypto?.subtle) {
      this.emit.status('error');
      this.emit.error('This browser cannot open a secure table connection.');
      return;
    }
    this.closedByUs = false;
    this.emit.status(this.retries === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.key = null;
    this.outboundSeq = 0;
    this.lastInboundSeq = 0;

    ws.onmessage = (event: MessageEvent<string>): void => {
      // Never swallow a failure here: anything thrown mid-handshake used to leave the client
      // sitting on "connecting" forever with no clue why.
      this.inbound = this.inbound
        .then(() => this.onMessage(event.data))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[table socket]', err);
          this.emit.status('error');
          this.emit.error(`Table connection failed: ${message}`);
          this.closedByUs = true; // a broken handshake won't fix itself by retrying
          ws.close();
        });
    };
    ws.onclose = (event: CloseEvent): void => {
      if (this.ws === ws) this.ws = null;
      if (this.closedByUs) return this.emit.status('closed');

      // The server says why it hung up (close code 4000 + a reason). Some of those will never heal
      // by retrying, so report them instead of looping silently.
      const fatal: Record<string, string> = {
        unauthorized: 'The table rejected your session. Sign in again.',
        handshake_timeout: 'The table did not answer the handshake in time.',
        rate_limited: 'Too many messages — the table dropped the connection.',
      };
      const explanation = fatal[event.reason];
      if (explanation) {
        this.closedByUs = true;
        this.emit.status('error');
        this.emit.error(explanation);
        if (event.reason === 'unauthorized' && !this.dead) this.handlers.onUnauthorized?.();
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = (): void => {
      // `onclose` always follows; reconnection is handled there.
    };
  }

  /** Send a table command. Silently ignored until the handshake completes. */
  send(command: TableCommand): void {
    void this.sendInner({ type: 'action', roomId: this.tableId, action: command });
  }

  on(event: string, callback: (data: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  off(event: string, callback: (data: unknown) => void): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  close(): void {
    this.closedByUs = true;
    this.dead = true; // from here on this instance says nothing, however late its events arrive
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      void this.sendInner({ type: 'leave', roomId: this.tableId }, ws).finally(() => ws.close());
    } else {
      ws?.close();
    }
    // Deliberately no status here. Whoever closed this socket is either unmounting or has already
    // opened a replacement; a parting "closed" would only overwrite the new one's state.
  }

  // ── Wire handling ───────────────────────────────────────────────────────────

  private async onMessage(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    // Handshake frames are plaintext — there's no shared key yet.
    const frame = parsed as { t?: string; serverPublicKey?: string };
    if (frame.t === 'server_hello' && frame.serverPublicKey) {
      await this.completeHandshake(frame.serverPublicKey);
      return;
    }
    if (frame.t === 'ready') {
      this.retries = 0;
      this.emit.status('ready');
      await this.sendInner({ type: 'join', roomId: this.tableId });
      return;
    }

    const envelope = parsed as Envelope;
    if (!this.key || typeof envelope.payload !== 'string' || typeof envelope.mac !== 'string') return;
    if (envelope.seq <= this.lastInboundSeq) return; // replayed or reordered — drop it
    if (!(await verify(this.key, envelope.seq, envelope.payload, envelope.mac))) {
      this.emit.error('Dropped a table message that failed its signature check.');
      return;
    }
    this.lastInboundSeq = envelope.seq;

    const message = JSON.parse(envelope.payload) as
      | { type: 'state'; roomId: string; state: TableSnapshot }
      | { type: 'event'; roomId: string; event: string; data: unknown }
      | { type: 'error'; message: string };

    if (message.type === 'state') this.emit.snapshot(message.state);
    else if (message.type === 'event') {
      const listeners = this.eventListeners.get(message.event);
      if (listeners) {
        for (const cb of listeners) cb(message.data);
      }
    }
    else if (message.type === 'error') this.emit.error(message.message);
  }

  private async completeHandshake(serverPublicKeyB64: string): Promise<void> {
    // X25519 in WebCrypto is recent (Chrome 133, Firefox 132, Safari 17.4). Say so plainly rather
    // than surfacing a raw NotSupportedError from deep inside the handshake.
    let pair: CryptoKeyPair;
    try {
      pair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
        'deriveBits',
      ])) as CryptoKeyPair;
    } catch {
      throw new Error('this browser does not support X25519 — update it, or open the app in Telegram');
    }

    const serverKey = await crypto.subtle.importKey(
      'spki',
      fromBase64(serverPublicKeyB64).buffer as ArrayBuffer,
      { name: 'X25519' },
      false,
      [],
    );
    const shared = await crypto.subtle.deriveBits(
      { name: 'X25519', public: serverKey },
      pair.privateKey,
      256,
    );
    // Same HKDF the server runs: SHA-256, empty salt, info 'fairplay-ws-v1', 32 bytes.
    const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
    const sessionKey = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(HKDF_INFO),
      },
      hkdfKey,
      256,
    );
    this.key = await crypto.subtle.importKey(
      'raw',
      sessionKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const publicKeyB64 = toBase64(await crypto.subtle.exportKey('spki', pair.publicKey));
    this.raw({ t: 'client_hello', clientPublicKey: publicKeyB64, token: this.token });
  }

  private async sendInner(message: unknown, socket?: WebSocket): Promise<void> {
    const ws = socket ?? this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.key) return;
    const payload = JSON.stringify(message);
    const seq = ++this.outboundSeq;
    ws.send(JSON.stringify({ seq, payload, mac: await sign(this.key, seq, payload) }));
  }

  private raw(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    this.emit.status('reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.retries);
    this.retries += 1;
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

async function sign(key: CryptoKey, seq: number, payload: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${seq}.${payload}`));
  return toHex(mac);
}

async function verify(key: CryptoKey, seq: number, payload: string, mac: string): Promise<boolean> {
  return (await sign(key, seq, payload)) === mac;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
