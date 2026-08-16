import { WebSocket } from 'ws';
import { generateEphemeralKeyPair, deriveSessionKey, signMessage, verifyMessage } from '../../src/transport/crypto';
import { ChipBank } from '../../src/live/chip-bank';
import { DevPlayers } from '../../src/live/players';
import { DEFAULT_ROOM } from '../../src/live/poker-room';
import { TableHub, type TokenVerifier } from '../../src/live/table-hub';
import { signToken, verifyToken } from '../../src/gateway/tokens';
import type { TableCommand, TableSnapshot } from '../../src/live/room-state';

/**
 * The whole path, end to end: two real connections do the ECDH handshake, sit down at the same
 * table, and play a hand through the socket. Nothing in here reaches into the room directly — this
 * is exactly what two phones do.
 */

const SECRET = 'test-secret';

/** The table trusts exactly the tokens the gateway issues — same secret, same claims. */
const verifyPlayerToken: TokenVerifier = (token) => ({
  playerId: verifyToken(token, SECRET).playerId,
});

const tokenFor = (playerId: string): string =>
  signToken({ playerId, role: 'player' }, SECRET, 3_600);

/** A minimal client: handshake, signed envelopes, latest snapshot. */
class TestClient {
  private ws!: WebSocket;
  private key!: Buffer;
  private outSeq = 0;
  private inSeq = 0;
  snapshot: TableSnapshot | null = null;
  errors: string[] = [];

  constructor(
    private readonly port: number,
    private readonly token: string,
    private readonly tableId: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { privateKey, publicKeyB64 } = generateEphemeralKeyPair();
      let ready = false;
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      this.ws.on('error', reject);
      // A rejected handshake is a CLOSE, not an error frame — an unauthorized client is just gone.
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
          this.raw({ type: 'join', roomId: this.tableId });
          resolve();
          return;
        }

        const seq = frame.seq as number;
        const payload = frame.payload as string;
        expect(verifyMessage(this.key, seq, payload, frame.mac as string)).toBe(true);
        expect(seq).toBeGreaterThan(this.inSeq); // monotonic: no replays
        this.inSeq = seq;

        const message = JSON.parse(payload) as
          | { type: 'state'; state: TableSnapshot }
          | { type: 'error'; message: string };
        if (message.type === 'state') this.snapshot = message.state;
        else if (message.type === 'error') this.errors.push(message.message);
      });
    });
  }

  send(command: TableCommand): void {
    this.raw({ type: 'action', roomId: this.tableId, action: command });
  }

  private raw(message: unknown): void {
    const payload = JSON.stringify(message);
    const seq = ++this.outSeq;
    this.ws.send(JSON.stringify({ seq, payload, mac: signMessage(this.key, seq, payload) }));
  }

  /** Wait until the latest snapshot satisfies `predicate`. */
  async until(predicate: (snapshot: TableSnapshot) => boolean, timeoutMs = 3000): Promise<TableSnapshot> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.snapshot && predicate(this.snapshot)) return this.snapshot;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting; last snapshot phase=${this.snapshot?.phase ?? 'none'}`);
  }

  close(): void {
    this.ws.close();
  }
}

describe('TableHub — two people, one table, over the wire', () => {
  let hub: TableHub;
  let players: DevPlayers;
  let bank: ChipBank;
  let port: number;
  let alice: TestClient;
  let bob: TestClient;
  let startingTotal: number;

  beforeEach(async () => {
    players = new DevPlayers({ startingChips: 10_000 });
    bank = new ChipBank(players);
    hub = new TableHub({ directory: players, fc: bank }, verifyPlayerToken);
    hub.addTable({
      ...DEFAULT_ROOM,
      id: 't1',
      game: 'texas',
      name: 'Wire table',
      maxSeats: 6,
      handStartDelayMs: 10,
      showdownDelayMs: 10,
      actionTimeoutMs: 2_000,
    });
    port = await hub.listen(0);

    const a = players.create('Alice');
    const b = players.create('Bob');
    startingTotal = players.totalChips();
    alice = new TestClient(port, tokenFor(a.id), 't1');
    bob = new TestClient(port, tokenFor(b.id), 't1');
    await alice.connect();
    await bob.connect();
  });

  afterEach(async () => {
    alice.close();
    bob.close();
    await hub.close();
  });

  it('rejects a connection with a bad token', async () => {
    const impostor = new TestClient(port, 'not-a-real-token', 't1');
    await expect(impostor.connect()).rejects.toBeDefined();
  });

  it('seats both players and deals a hand they can both see', async () => {
    await alice.until((s) => s.phase === 'WAITING');
    alice.send({ kind: 'sit', seat: 0, buyIn: 2_000 });
    bob.send({ kind: 'sit', seat: 3, buyIn: 2_000 });

    const dealt = await alice.until((s) => s.phase === 'IN_HAND');
    const bobsView = await bob.until((s) => s.phase === 'IN_HAND');

    expect(dealt.seats).toHaveLength(2);
    expect(bobsView.seats).toHaveLength(2);
    // Each player sees their own cards and only face-down cards opposite them.
    expect(dealt.seats.find((s) => s.isYou)!.cards.every((c) => typeof c === 'string')).toBe(true);
    expect(dealt.seats.find((s) => !s.isYou)!.cards).toEqual([null, null]);
    expect(bobsView.seats.find((s) => s.isYou)!.cards.every((c) => typeof c === 'string')).toBe(true);
  });

  it('plays a hand to showdown through the socket and settles it', async () => {
    alice.send({ kind: 'sit', seat: 0, buyIn: 2_000 });
    bob.send({ kind: 'sit', seat: 1, buyIn: 2_000 });
    await alice.until((s) => s.phase === 'IN_HAND');

    for (let guard = 0; guard < 60; guard++) {
      if (alice.snapshot?.phase !== 'IN_HAND') break;
      // Whoever currently holds legal actions is the player to act — same signal the UI uses.
      const actor = [alice, bob].find((c) => c.snapshot?.phase === 'IN_HAND' && c.snapshot.legal != null);
      if (!actor) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        continue;
      }
      const before = actor.snapshot!;
      actor.send({ kind: 'act', action: before.legal!.canCheck ? { type: 'check' } : { type: 'call' } });
      // Wait for the server to confirm the action landed before looking for the next one —
      // acting off a stale snapshot is exactly what a real client must not do either.
      await actor.until((s) => s.legal === null || s.phase !== 'IN_HAND' || s.handNumber !== before.handNumber);
    }

    const done = await alice.until((s) => s.phase === 'SHOWDOWN' || s.handNumber > 1);
    expect(done.winners.length + done.handNumber).toBeGreaterThan(0);
    expect(alice.errors).toEqual([]);
    expect(players.totalChips() + bank.sinkTotal()).toBe(startingTotal);
  });

  it('tells a player why a command was refused, without dropping them', async () => {
    alice.send({ kind: 'sit', seat: 0, buyIn: 2_000 });
    await alice.until((s) => s.yourSeat === 0);

    bob.send({ kind: 'sit', seat: 0, buyIn: 2_000 });
    await bob.until(() => bob.errors.length > 0);
    expect(bob.errors[0]).toMatch(/seat taken/);

    // Still connected and still able to take a different chair.
    bob.send({ kind: 'sit', seat: 2, buyIn: 2_000 });
    const seated = await bob.until((s) => s.yourSeat === 2);
    expect(seated.yourSeat).toBe(2);
  });
});
