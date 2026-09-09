/**
 * Drive a real seated player over the table socket, to prove the one-table
 * rule end to end: sit, see the lobby mark the row, get refused BY NAME at a
 * second table, stand, and be free again.
 *
 * Uses the shipped transport crypto rather than reimplementing it — the
 * handshake is ECDH + HKDF with an HMAC per message and there is no bypass, so
 * a hand-rolled client would be testing my copy of the protocol, not the one
 * that runs.
 *
 *   npx ts-node seat-probe.ts <gatewayHttpUrl> <email> <password>
 */
import WebSocket from 'ws';
import {
  generateEphemeralKeyPair,
  deriveSessionKey,
  signMessage,
} from './src/transport/crypto';

const HTTP = process.argv[2] ?? 'http://127.0.0.1:4101';
const EMAIL = process.argv[3] ?? 'tester@mypoker777.com';
const PASSWORD = process.argv[4] ?? 'device testing password';
const WS = HTTP.replace(/^http/, 'ws') + '/ws';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function login(): Promise<string> {
  const res = await fetch(`${HTTP}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

async function lobby(token?: string): Promise<{
  tables: { id: string; name: string; youAreSeated?: boolean }[];
  seatedAt?: string;
}> {
  const res = await fetch(`${HTTP}/lobby/tables`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return (await res.json()) as never;
}

class Client {
  private ws!: WebSocket;
  private key!: Buffer;
  private seq = 0;
  readonly errors: string[] = [];
  ready = false;

  constructor(private readonly token: string) {}

  connect(): Promise<void> {
    const pair = generateEphemeralKeyPair();
    this.ws = new WebSocket(WS);
    return new Promise((resolve, reject) => {
      this.ws.on('message', (raw: Buffer) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.t === 'server_hello') {
          this.key = deriveSessionKey(pair.privateKey, msg.serverPublicKey as string);
          this.ws.send(
            JSON.stringify({ t: 'client_hello', clientPublicKey: pair.publicKeyB64, token: this.token }),
          );
          return;
        }
        if (msg.t === 'ready') {
          this.ready = true;
          resolve();
          return;
        }
        // Post-handshake frames are signed envelopes; only the payload matters here.
        if (typeof msg.payload === 'string') {
          const inner = JSON.parse(msg.payload) as { type?: string; message?: string };
          if (inner.type === 'error') this.errors.push(inner.message ?? '(no message)');
        }
      });
      this.ws.on('error', reject);
      setTimeout(() => reject(new Error('handshake timed out')), 15_000);
    });
  }

  private send(inner: unknown): void {
    const payload = JSON.stringify(inner);
    // PRE-increment: the session rejects `seq <= lastInboundSeq` starting from
    // 0, so the first frame must be 1. Starting at 0 costs a strike and three
    // strikes drop the connection.
    const seq = ++this.seq;
    this.ws.send(JSON.stringify({ seq, payload, mac: signMessage(this.key, seq, payload) }));
  }

  join(roomId: string): void {
    this.send({ type: 'join', roomId });
  }
  action(roomId: string, action: unknown): void {
    this.send({ type: 'action', roomId, action });
  }
  close(): void {
    this.ws.close();
  }
}

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const token = await login();
  const before = await lobby(token);
  const A = before.tables.find((t) => t.name.includes("Hold'em"))!;
  const B = before.tables.find((t) => t.id === 'omaha')!;
  console.log(`\ntable A = ${A.id} (${A.name})\ntable B = ${B.id} (${B.name})\n`);

  const c = new Client(token);
  await c.connect();
  c.join(A.id);
  await sleep(1500);

  console.log('1. sit at A');
  c.action(A.id, { kind: 'sit', seat: 0, buyIn: 2000 });
  await sleep(2500);
  const seated = await lobby(token);
  const rowA = seated.tables.find((t) => t.id === A.id);
  check('the seat was taken', seated.seatedAt === A.id, `seatedAt=${seated.seatedAt} errors=${c.errors.join('|')}`);
  check('the lobby marks that row', rowA?.youAreSeated === true, JSON.stringify(rowA));
  check(
    'and marks ONLY that row',
    seated.tables.filter((t) => t.youAreSeated).length === 1,
    String(seated.tables.filter((t) => t.youAreSeated).length),
  );

  console.log('\n2. an anonymous viewer sees no marker');
  const anon = await lobby();
  check('nothing marked without a token', anon.tables.every((t) => !t.youAreSeated), '');
  check('and no seatedAt', anon.seatedAt === undefined, String(anon.seatedAt));

  console.log('\n3. try to sit at B while seated at A');
  c.errors.length = 0;
  c.join(B.id);
  await sleep(1200);
  c.action(B.id, { kind: 'sit', seat: 0, buyIn: 2000 });
  await sleep(2000);
  const refusal = c.errors.join(' | ');
  check('refused', /one table at a time/i.test(refusal), `errors=${refusal}`);
  check('and NAMES the table to stand up at', refusal.includes(A.name), `"${refusal}"`);

  console.log('\n4. stand at A');
  c.errors.length = 0;
  c.action(A.id, { kind: 'stand' });
  await sleep(2500);
  const freed = await lobby(token);
  check('seat released', freed.seatedAt === undefined, `seatedAt=${freed.seatedAt}`);
  check('no row marked', freed.tables.every((t) => !t.youAreSeated), '');

  console.log('\n5. now B accepts');
  c.errors.length = 0;
  c.action(B.id, { kind: 'sit', seat: 0, buyIn: 2000 });
  await sleep(2500);
  const atB = await lobby(token);
  check('seated at B', atB.seatedAt === B.id, `seatedAt=${atB.seatedAt} errors=${c.errors.join('|')}`);

  // leave it clean
  c.action(B.id, { kind: 'stand' });
  await sleep(1500);
  c.close();
  console.log('\ndone');
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
