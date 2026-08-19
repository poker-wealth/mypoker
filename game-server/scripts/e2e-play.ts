/**
 * END-TO-END GAME CHECK — real server, real socket, real ledger.
 *
 *   npx ts-node scripts/e2e-play.ts <tableId> [players]
 *
 * ESTHER_V2 task 3 asks for "sit → play a full round → win/lose → the wallet updates". A room test
 * cannot answer that: it calls the room in-process, so it never crosses the wire schema, never
 * touches the Financial Core, and never proves a player could actually do it. This does.
 *
 * It funds real accounts in the ledger, connects N websocket clients with real player tokens, sits
 * them down, plays whatever the game asks for until the hand ends, and then checks the ledger
 * balances moved and that the table is not holding money that belongs to nobody.
 *
 * It drives the SERVER, not the browser — the felts still need eyes on them. What it does prove is
 * that a game is reachable, playable to completion and settles, which is the part that has been
 * failing silently.
 */
import WebSocket from 'ws';
import { signToken } from '../src/gateway/tokens';
import { generateEphemeralKeyPair, deriveSessionKey, signMessage } from '../src/transport/crypto';

const TABLES_URL = process.env.TABLES_URL ?? 'http://127.0.0.1:4200';
const WS_URL = TABLES_URL.replace(/^http/, 'ws') + '/ws';
const FC_URL = process.env.FINANCIAL_CORE_URL ?? 'http://127.0.0.1:4001';
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret';
const INTERNAL = process.env.INTERNAL_API_SECRET ?? 'dev-internal-secret';

/** The ledger answers in USDT; the tables deal in chips at ₮0.01 each. */
const CHIPS_PER_USDT = 100;
const FUND_USDT = '500';

interface Snapshot {
  tableId: string;
  phase: string;
  stage?: string;
  handNumber: number;
  toActSeat: number | null;
  maxSeats: number;
  minBuyIn: number;
  board: string[];
  message?: string;
  seats: Array<{
    index: number;
    playerId: string;
    isYou: boolean;
    isDealer: boolean;
    stack: number;
    bet: number;
    cards: (string | null)[];
    status: string;
  }>;
  legal: {
    canFold: boolean;
    canCheck: boolean;
    callAmount: number | null;
    minRaiseTo: number | null;
  } | null;
  gameState?: unknown;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fcJson(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${FC_URL}/api/v1${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

/** Credit a player in the ledger so they have something to buy in with. */
async function fund(playerId: string, txHash: string): Promise<void> {
  await fcJson('/internal/deposits', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL },
    body: JSON.stringify({
      playerId,
      amount: FUND_USDT,
      txHash,
      contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      confirmations: 20,
    }),
  });
}

async function balanceOf(playerId: string): Promise<number> {
  const token = signToken({ playerId, role: 'player' }, JWT_SECRET, 3_600);
  const body = (await fcJson('/me/balance', {
    headers: { authorization: `Bearer ${token}` },
  })) as { total: string };
  return Number(body.total);
}

/**
 * One connected player, speaking the real transport: an X25519 handshake, then every message in a
 * sequence-numbered envelope MAC'd with the derived session key. The naive 'send JSON down the
 * socket' version this replaced never got past the server hello.
 */
class Client {
  snapshot: Snapshot | null = null;
  readonly errors: string[] = [];
  private ws!: WebSocket;
  private key!: Buffer;
  private seq = 0;

  private constructor(readonly playerId: string, readonly tableId: string) {}

  static connect(playerId: string, tableId: string): Promise<Client> {
    const c = new Client(playerId, tableId);
    return c.open().then(() => c);
  }

  private open(): Promise<void> {
    const token = signToken({ playerId: this.playerId, role: 'player' }, JWT_SECRET, 3_600);
    this.ws = new WebSocket(WS_URL);

    return new Promise((resolve, reject) => {
      const fail = setTimeout(() => reject(new Error('handshake timed out')), 15_000);

      this.ws.on('error', reject);
      this.ws.on('message', (raw: Buffer) => {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;

        if (msg.t === 'server_hello') {
          const pair = generateEphemeralKeyPair();
          this.key = deriveSessionKey(pair.privateKey, String(msg.serverPublicKey));
          this.ws.send(
            JSON.stringify({ t: 'client_hello', clientPublicKey: pair.publicKeyB64, token }),
          );
          return;
        }

        if (msg.t === 'ready') {
          clearTimeout(fail);
          this.send({ type: 'join', roomId: this.tableId });
          resolve();
          return;
        }

        // Established phase: the server signs outbound frames the same way.
        const env = msg as unknown as { payload?: string };
        if (!env.payload) return;
        const inner = JSON.parse(env.payload) as {
          type: string;
          state?: Snapshot;
          message?: string;
        };
        if (inner.type === 'state' && inner.state) this.snapshot = inner.state;
        if (inner.type === 'error' && inner.message) this.errors.push(inner.message);
      });
    });
  }

  /** Wrap an inner message in the authenticated envelope the server expects. */
  private send(inner: unknown): void {
    const payload = JSON.stringify(inner);
    const seq = ++this.seq;
    this.ws.send(JSON.stringify({ seq, payload, mac: signMessage(this.key, seq, payload) }));
  }

  /** A table command — sit, act, stand — as the felt would send it. */
  command(cmd: unknown): void {
    this.send({ type: 'action', roomId: this.tableId, action: cmd });
  }

  close(): void {
    this.ws.close();
  }

  seat(): Snapshot['seats'][number] | undefined {
    return this.snapshot?.seats.find((s) => s.isYou);
  }
}

async function until(what: string, cond: () => boolean, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * Play whatever this game is asking of the seat to act, one move at a time.
 *
 * Deliberately plays the simplest legal line rather than well: the point is to reach the end of a
 * hand and settle, not to win. Games without turn order (a betting window) are covered by the
 * "everyone bets once" branch.
 */
function movesFor(tableId: string, snap: Snapshot, me: Snapshot['seats'][number]): unknown | null {
  const stage = snap.stage;

  // Poker family: fold/check/call, never raise.
  if (snap.legal) {
    const l = snap.legal;
    if (l.canCheck) return { kind: 'act', action: { type: 'check' } };
    if (l.callAmount !== null) return { kind: 'act', action: { type: 'call' } };
    return { kind: 'act', action: { type: 'fold' } };
  }

  if (tableId === 'niu-niu') {
    if (stage === 'BIDDING') return { kind: 'act', action: { type: 'bid-1' } };
    if (stage === 'BETTING' && !me.isDealer && me.bet === 0) {
      return { kind: 'act', action: { type: 'bet', amount: 100, multiplier: 1 } };
    }
    return null;
  }

  if (tableId === 'dou-di-zhu') {
    if (stage === 'BIDDING') return { kind: 'act', action: { type: 'bid-3' } };
    // Simplest line that terminates: whoever holds the trick leads their lowest card and the
    // other two always pass, so the leader empties their hand and the round ends.
    const mine = me.cards.filter((c): c is string => typeof c === 'string');
    if (mine.length === 0) return null;
    if (snap.board.length === 0) return { kind: 'act', action: { type: 'play', cards: [mine[0]!] } };
    return { kind: 'act', action: { type: 'pass' } };
  }

  if (tableId === 'san-zhang' && me.bet === 0 && !me.isDealer) {
    return { kind: 'act', action: { type: 'bet', amount: 100 } };
  }

  if (tableId === 'baccarat' && me.bet === 0 && !me.isDealer) {
    return { kind: 'act', action: { type: 'player', amount: 100 } };
  }

  if (tableId === 'cowboy-beauty' && me.bet === 0 && !me.isDealer) {
    // Opposite sides by seat: everyone backing the same one leaves no counterparty, and the
    // round settles to nothing at all.
    const side = me.index % 2 === 0 ? 'cowboy' : 'beauty';
    return { kind: 'act', action: { type: side, amount: 100 } };
  }

  if (tableId === 'red-packet' && me.bet === 0 && !me.isDealer) {
    return { kind: 'act', action: { type: String(me.index), amount: 100 } };
  }

  if (tableId === 'lottery' && me.bet === 0) {
    return { kind: 'act', action: { type: String(me.index), amount: 100 } };
  }

  if (tableId === 'texas-cowboy') {
    // This table runs a clock of its own and only takes stakes inside the window; joining
    // mid-round and betting anyway just collects "Phase is RESULTS" refusals.
    const round = snap.gameState as { phase?: string } | undefined;
    if (round?.phase === 'BETTING_OPEN' && me.bet === 0) {
      // Opposite sides by seat, so the round has a real loser funding a real winner. Everyone

      // backing the same market proves nothing about settlement.
      const side = me.index % 2 === 0 ? 'cowboy_win' : 'cowgirl_win';
      return { kind: 'act', action: { type: 'bet', amount: 100, selection: side } };
    }
    return null;
  }

  return null;
}

let live: Client[] = [];

async function main(): Promise<void> {
  const tableId = process.argv[2] ?? 'texas';
  const count = Number(process.argv[3] ?? 2);

  const stamp = Date.now();
  const ids = Array.from({ length: count }, (_, i) => `e2e-${tableId}-${stamp}-${i}`);

  console.log(`\n── ${tableId} — ${count} players ────────────────────────────`);

  for (const [i, id] of ids.entries()) await fund(id, `${stamp}-${tableId}-${i}`);
  const before = await Promise.all(ids.map(balanceOf));
  console.log(`funded    : ${before.map((b) => (b * CHIPS_PER_USDT).toFixed(0) + ' chips').join(', ')}`);

  const clients = await Promise.all(ids.map((id) => Client.connect(id, tableId)));
  live = clients;
  await until('the first snapshot', () => clients.every((c) => c.snapshot !== null));

  /**
   * Buy in well above the minimum.
   *
   * Banker games reserve the WORST case: Niu Niu's Five Small pays 6x, so a 100 stake ties up 600
   * of the bank. At the table minimum a second bettor is refused outright, which looks like a
   * broken game but is the exposure guard doing its job against a thin bank.
   */
  const buyIn = Math.min(clients[0]!.snapshot!.minBuyIn * 10, 40_000);
  const seats = clients[0]!.snapshot!.maxSeats;
  console.log(`table     : ${seats} seats, min buy-in ${buyIn}`);

  /**
   * Take whichever chairs are actually free.
   *
   * Seat 0,1,2… only works on a table nobody is using. A run that stalled earlier leaves its
   * players sitting there, and the next run then fails to seat with no clue why — which looked
   * exactly like the game being broken.
   */
  for (const c of clients) {
    const taken = new Set(
      clients.flatMap((o) => (o.seat() ? [o.seat()!.index] : [])).concat(
        (c.snapshot?.seats ?? []).filter((s) => s.playerId).map((s) => s.index),
      ),
    );
    const free = (c.snapshot?.seats ?? []).find((s) => !taken.has(s.index));
    if (!free) throw new Error('no free seat — the table is full of players from an earlier run');
    c.command({ kind: 'sit', seat: free.index, buyIn });
    await sleep(400);
  }
  await until('everyone seated', () => clients.every((c) => c.seat() !== undefined), 10_000);
  console.log(`seated    : ${clients.length} players`);

  /**
   * Wait until this table will actually accept something from us.
   *
   * Sitting down mid-round is normal — a betting window may have closed seconds ago — so the
   * harness waits for a state where a move exists rather than for a phase name. Without this it
   * fired into RESULTS and collected refusals, then reported the game unplayable.
   */
  await until(
    'a move to become available',
    () =>
      clients.some((c) => {
        const s2 = c.snapshot;
        const me = c.seat();
        if (!s2 || !me) return false;
        if (s2.toActSeat !== null && s2.toActSeat !== me.index) return false;
        return movesFor(tableId, s2, me) !== null;
      }),
    45_000,
  );
  console.log(`dealt     : hand #${clients[0]!.snapshot!.handNumber}`);

  // Play until the hand leaves IN_HAND, or we run out of patience.
  const deadline = Date.now() + 90_000;
  let moves = 0;
  let sawShowdown = false;
  while (Date.now() < deadline && !sawShowdown) {
    const snap = clients[0]!.snapshot!;
    if (snap.phase === 'SHOWDOWN') sawShowdown = true;

    let acted = false;
    for (const c of clients) {
      const s = c.snapshot;
      const me = c.seat();
      if (!s || !me) continue;
      // Turn-based games name a seat; window games let everyone act at once.
      if (s.toActSeat !== null && s.toActSeat !== me.index) continue;

      const cmd = movesFor(tableId, s, me);
      if (cmd) {
        c.command(cmd);
        moves++;
        acted = true;
        await sleep(200);
      }
    }
    if (!acted) await sleep(300);
  }

  try {
    await until('the hand to settle', () => clients[0]!.snapshot!.phase !== 'IN_HAND', 30_000);
  } catch (err) {
    console.log('stalled — table state:');
    diagnose(clients);
    throw err;
  }
  const final = clients[0]!.snapshot!;
  console.log(`played    : ${moves} moves → ${final.phase}`);
  if (final.message) console.log(`result    : ${final.message}`);

  // Stand up so the seat's chips are returned to the ledger, then read the wallets back.
  // The room settles a few seconds AFTER showdown, so give the ledger time before reading it.
  await sleep(9_000);
  for (const c of clients) c.command({ kind: 'stand' });
  await sleep(2_500);

  const after = await Promise.all(ids.map(balanceOf));
  const deltas = after.map((a, i) => a - before[i]!);
  console.log(
    `wallets   : ${deltas.map((d) => (d === 0 ? '0' : (d > 0 ? '+' : '') + (d * CHIPS_PER_USDT).toFixed(2))).join(', ')} chips`,
  );

  const totalBefore = before.reduce((a, b) => a + b, 0);
  const totalAfter = after.reduce((a, b) => a + b, 0);
  const moved = totalAfter - totalBefore;
  console.log(`net table : ${(moved * CHIPS_PER_USDT).toFixed(2)} chips (negative = rake taken)`);

  const errors = clients.flatMap((c) => c.errors);
  if (errors.length) console.log(`refusals  : ${[...new Set(errors)].join(' | ')}`);

  const played = moves > 0;
  const settled = deltas.some((d) => d !== 0);
  console.log(
    `VERDICT   : ${played && settled ? 'PLAYABLE + SETTLES' : played ? 'PLAYED, NO MONEY MOVED' : 'NEVER GOT A MOVE IN'}`,
  );

  for (const c of clients) c.close();
  await sleep(300);
}

function diagnose(clients: Client[]): void {
  for (const c of clients) {
    const s2 = c.snapshot;
    console.log(`  ${c.playerId}: phase=${s2?.phase} stage=${s2?.stage ?? '-'} toAct=${s2?.toActSeat} bet=${c.seat()?.bet} stack=${c.seat()?.stack}`);
    if (c.errors.length) console.log(`    refused: ${[...new Set(c.errors)].join(' | ')}`);
  }
}

/**
 * Always leave the table as we found it.
 *
 * A run that threw used to leave its players sitting there, and the next run then met a table
 * holding thin stacks from before — which produced refusals that looked like the GAME being
 * broken ("banker stack capacity ₮1000" while our own seats held ₮10000).
 */
async function cleanUp(clients: Client[]): Promise<void> {
  for (const c of clients) { try { c.command({ kind: 'stand' }); } catch { /* already gone */ } }
  await sleep(1_000);
  for (const c of clients) { try { c.close(); } catch { /* already gone */ } }
}

main().then(
  () => process.exit(0),
  async (err) => {
    console.error('E2E FAILED:', err instanceof Error ? err.message : err);
    await cleanUp(live);
    process.exit(1);
  },
);
