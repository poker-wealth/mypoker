import { WebSocket } from 'ws';
import {
  generateEphemeralKeyPair,
  deriveSessionKey,
  signMessage,
  verifyMessage,
} from '../../src/transport/crypto';
import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM } from '../../src/live/poker-room';
import { TableHub, type TokenVerifier } from '../../src/live/table-hub';
import { TableAccess } from '../../src/gateway/table-access';
import { signToken, verifyToken } from '../../src/gateway/tokens';

/**
 * The private-table guard, on the rail that actually carries it.
 *
 * `test/gateway/table-access.test.ts` proves the policy decides correctly. This
 * file proves the socket asks it — which is a different claim, and the one this
 * codebase has got wrong twice.
 *
 * TRAPS §23: suspension was enforced on HTTP and not on the socket, and
 * eighteen passing tests never noticed, because they mount a bare HTTP route
 * and never open a connection. TRAPS §20 is the same shape one size smaller.
 * So this test opens a real socket, does the real ECDH handshake, and sends
 * real signed envelopes.
 *
 * TWO DOORS. `join` subscribes you to snapshots; `action` acts on the room and
 * never checks whether you joined first. Guarding only `join` would leave
 * `action: sit` open, so both are asserted here separately. If someone later
 * moves the check from `onInbound` into the `join` case, the sit test goes red.
 */

const SECRET = 'test-secret';

const verifyPlayerToken: TokenVerifier = (token) => ({
  playerId: verifyToken(token, SECRET).playerId,
});

const tokenFor = (playerId: string): string =>
  signToken({ playerId, role: 'player' }, SECRET, 3_600);

/**
 * A client that does NOT auto-join, unlike the one in table-hub.test.ts — the
 * whole point here is to control exactly which verb is sent and when.
 */
class Client {
  private ws!: WebSocket;
  private key!: Buffer;
  private outSeq = 0;
  errors: string[] = [];
  states = 0;

  constructor(
    private readonly port: number,
    private readonly token: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { privateKey, publicKeyB64 } = generateEphemeralKeyPair();
      let ready = false;
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      this.ws.on('error', reject);
      this.ws.on('close', (code: number, reason: Buffer) => {
        if (!ready) reject(new Error(`closed before ready: ${code} ${reason.toString()}`));
      });
      this.ws.on('message', (raw: Buffer) => {
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (frame.t === 'server_hello') {
          this.key = deriveSessionKey(privateKey, frame.serverPublicKey as string);
          this.ws.send(
            JSON.stringify({ t: 'client_hello', clientPublicKey: publicKeyB64, token: this.token }),
          );
          return;
        }
        if (frame.t === 'ready') {
          ready = true;
          resolve();
          return;
        }
        const seq = frame.seq as number;
        const payload = frame.payload as string;
        expect(verifyMessage(this.key, seq, payload, frame.mac as string)).toBe(true);
        const message = JSON.parse(payload) as
          | { type: 'state' }
          | { type: 'error'; message: string };
        if (message.type === 'error') this.errors.push(message.message);
        else if (message.type === 'state') this.states += 1;
      });
    });
  }

  join(roomId: string): void {
    this.raw({ type: 'join', roomId });
  }

  sit(roomId: string): void {
    this.raw({ type: 'action', roomId, action: { kind: 'sit', seat: 0, buyIn: 1_000 } });
  }

  private raw(message: unknown): void {
    const payload = JSON.stringify(message);
    const seq = ++this.outSeq;
    this.ws.send(JSON.stringify({ seq, payload, mac: signMessage(this.key, seq, payload) }));
  }

  /** Give the server a moment to answer; these are all sub-millisecond checks. */
  async settle(ms = 150): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  close(): void {
    this.ws.close();
  }
}

describe('private tables — the guard on the socket rail', () => {
  let hub: TableHub;
  let players: DevPlayers;
  let access: TableAccess;
  let port: number;
  let stranger: Client;
  let strangerId: string;
  let code: string;

  beforeEach(async () => {
    players = new DevPlayers({ startingChips: 10_000 });
    access = new TableAccess();

    hub = new TableHub(
      { directory: players, fc: new ChipBank(players) },
      verifyPlayerToken,
      undefined,
      (tableId, playerId) => access.mayJoin(tableId, playerId),
    );
    hub.addTable({
      ...DEFAULT_ROOM,
      id: 't-private',
      game: 'texas',
      name: 'Private table',
      maxSeats: 6,
      handStartDelayMs: 10,
    });
    hub.addTable({
      ...DEFAULT_ROOM,
      id: 't-public',
      game: 'texas',
      name: 'Public table',
      maxSeats: 6,
      handStartDelayMs: 10,
    });

    code = access.register('t-private', 'private', 'the-creator') as string;
    access.register('t-public', 'public', 'the-creator');

    port = await hub.listen(0);
    strangerId = players.create('Stranger').id;
    stranger = new Client(port, tokenFor(strangerId));
    await stranger.connect();
  });

  afterEach(async () => {
    stranger.close();
    await hub.close();
  });

  // ── Door one ───────────────────────────────────────────────────────────────

  it('refuses to let a stranger WATCH a private table', async () => {
    stranger.join('t-private');
    await stranger.settle();

    expect(stranger.errors).toContain('this table needs its invite code');
    // And crucially: no snapshot leaked before the refusal.
    expect(stranger.states).toBe(0);
  });

  // ── Door two, which does not depend on door one ────────────────────────────

  it('refuses to let a stranger SIT at a private table without joining first', async () => {
    // Note there is no join() here. `action` reaches the room on its own; a
    // guard that only covered `join` would let this straight through.
    stranger.sit('t-private');
    await stranger.settle();

    expect(stranger.errors).toContain('this table needs its invite code');
    expect(players.find(strangerId)?.available).toBe(10_000); // no buy-in taken
  });

  // ── The same doors, once the code is presented ─────────────────────────────

  it('lets the same player in on both doors once they unlock', async () => {
    expect(access.unlock('t-private', strangerId, code)).toBe('ok');

    stranger.join('t-private');
    await stranger.settle();
    expect(stranger.errors).toHaveLength(0);
    expect(stranger.states).toBeGreaterThan(0);

    stranger.sit('t-private');
    await stranger.settle();
    expect(stranger.errors).toHaveLength(0);
  });

  // ── The guard must not have made everything private ────────────────────────

  it('leaves a public table open to anyone', async () => {
    stranger.join('t-public');
    await stranger.settle();

    expect(stranger.errors).toHaveLength(0);
    expect(stranger.states).toBeGreaterThan(0);
  });

  it('leaves a table the registry never heard of open — the lobby must not go dark', async () => {
    hub.addTable({
      ...DEFAULT_ROOM,
      id: 'texas',
      game: 'texas',
      name: 'A fixed lobby table',
      maxSeats: 6,
      handStartDelayMs: 10,
    });

    stranger.join('texas');
    await stranger.settle();

    expect(stranger.errors).toHaveLength(0);
    expect(stranger.states).toBeGreaterThan(0);
  });

  it('does not admit a player who unlocked a DIFFERENT table', async () => {
    const other = new TableAccess();
    const otherCode = other.register('t-private', 'private', 'someone-else') as string;
    // Same shape of code, wrong registry — the player never unlocked ours.
    expect(access.unlock('t-private', strangerId, otherCode === code ? '999999' : otherCode)).not.toBe(
      'ok',
    );

    stranger.join('t-private');
    await stranger.settle();
    expect(stranger.errors).toContain('this table needs its invite code');
  });
});
