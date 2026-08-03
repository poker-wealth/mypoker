import { WebSocket } from 'ws';
import { GameSocketServer, type ClientContext } from '../../src/transport/ws-server';
import {
  generateEphemeralKeyPair,
  deriveSessionKey,
  signMessage,
} from '../../src/transport/crypto';
import type { Inbound } from '../../src/transport/protocol';

/** Minimal client that performs the handshake and signs envelopes — mirrors a real device. */
class TestClient {
  private ws: WebSocket;
  private key?: Buffer;
  private outSeq = 0;
  private readonly kp = generateEphemeralKeyPair();
  readonly states: unknown[] = [];
  readonly errors: string[] = [];
  private readyResolve?: () => void;
  closedCode?: number;

  constructor(port: number, private readonly token: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', (raw: Buffer) => this.onMessage(raw));
    this.ws.on('close', (code) => {
      this.closedCode = code;
    });
  }

  ready(): Promise<void> {
    return new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  private onMessage(raw: Buffer): void {
    const msg = JSON.parse(raw.toString());
    if (msg.t === 'server_hello') {
      this.key = deriveSessionKey(this.kp.privateKey, msg.serverPublicKey);
      this.ws.send(
        JSON.stringify({ t: 'client_hello', clientPublicKey: this.kp.publicKeyB64, token: this.token }),
      );
    } else if (msg.t === 'ready') {
      this.readyResolve?.();
    } else if (typeof msg.seq === 'number') {
      const inner = JSON.parse(msg.payload);
      if (inner.type === 'state') this.states.push(inner.state);
      if (inner.type === 'error') this.errors.push(inner.message);
    }
  }

  send(inner: Inbound): void {
    const payload = JSON.stringify(inner);
    const seq = ++this.outSeq;
    const mac = signMessage(this.key!, seq, payload);
    this.ws.send(JSON.stringify({ seq, payload, mac }));
  }

  /** Send with a deliberately broken MAC. */
  sendTampered(inner: Inbound): void {
    const payload = JSON.stringify(inner);
    const seq = ++this.outSeq;
    this.ws.send(JSON.stringify({ seq, payload, mac: 'deadbeef' }));
  }

  close(): void {
    this.ws.terminate();
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('GameSocketServer (secure transport, end-to-end)', () => {
  let server: GameSocketServer;
  let port: number;

  beforeAll(async () => {
    server = new GameSocketServer({
      verifyToken: (token) => {
        if (token !== 'good') throw new Error('bad token');
        return { playerId: 'p1' };
      },
      onInbound: (ctx: ClientContext, msg) => {
        if (msg.type === 'join') {
          ctx.session.rooms.add(msg.roomId);
          ctx.send({ type: 'state', roomId: msg.roomId, state: { joined: true, you: ctx.session.playerId } });
        } else if (msg.type === 'action') {
          ctx.send({ type: 'state', roomId: msg.roomId, state: { echo: msg.action } });
        }
      },
    });
    port = await server.listen(0);
  });

  afterAll(async () => {
    await server.close();
  });

  it('completes handshake, joins a room, and receives signed state', async () => {
    const c = new TestClient(port, 'good');
    await c.ready();
    c.send({ type: 'join', roomId: 't1' });
    await wait(150);
    expect(c.states).toContainEqual({ joined: true, you: 'p1' });
    c.send({ type: 'action', roomId: 't1', action: { type: 'bet', amount: '10' } });
    await wait(150);
    expect(c.states).toContainEqual({ echo: { type: 'bet', amount: '10' } });
    c.close();
  });

  it('rejects a tampered (bad-HMAC) message', async () => {
    const c = new TestClient(port, 'good');
    await c.ready();
    c.sendTampered({ type: 'join', roomId: 't1' });
    await wait(150);
    expect(c.errors.some((e) => e.includes('bad_hmac'))).toBe(true);
    c.close();
  });

  it('refuses a connection with an invalid auth token', async () => {
    const c = new TestClient(port, 'BAD');
    await wait(200);
    expect(c.closedCode).toBe(4000); // server closed the connection
    c.close();
  });
});
