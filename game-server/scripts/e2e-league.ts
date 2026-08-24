import WebSocket from 'ws';
import { generateEphemeralKeyPair, deriveSessionKey, signMessage } from '../src/transport/crypto';

/**
 * END-TO-END LEAGUE CHECK — can a player actually sit at a league private room?
 *
 *   npx ts-node scripts/e2e-league.ts
 *
 * SAMUEL_V2 task 3 says "verify a player can create AND JOIN a private table".
 * The create half was proved with curl; the join half was only ever checked by
 * reading the route, which is what PR #36 admits. This performs it.
 *
 * It matters because the league path has failed at a seam twice already: league
 * tables settled their rake to the platform Treasury until PokerRoom learned
 * league mode, and no member could be funded at all until grants existed. Both
 * were invisible to unit tests and obvious the moment someone tried to sit down.
 *
 * WHAT IT DRIVES — every step a real endpoint, no fixtures:
 *
 *   signup -> create league -> members join -> league settings
 *     -> platform hand, whose rake funds TREASURY
 *       -> top-up TREASURY -> LEAGUE_INVENTORY (request/approve/execute)
 *         -> GRANT league inventory -> member league wallets
 *           -> create the league table
 *             -> WebSocket handshake, join, SIT
 *
 * Then it asserts the players are actually seated and their league wallets
 * moved. Run `financial-core/scripts/ledger-integrity.ts` against the same
 * database afterwards: because nothing here is seeded by hand, a discrepancy
 * there would be a real one.
 *
 * KNOWN FAILING, ON PURPOSE (as of this commit)
 *
 * This script currently fails at the SIT with "not enough chips", and the
 * failure is real: the buy-in spends the PLATFORM wallet at a LEAGUE table.
 *
 *   game-server/src/live/fc-directory.ts:83  reads /internal/accounts/:id/balance
 *                                            with no scope -> platform balance
 *   game-server/src/core/financial-core-client.ts:162
 *                                            buyIn() posts no tableType/leagueId
 *                                            -> financial-core resolves PLATFORM
 *
 * Meanwhile settlement DOES carry tableType/leagueId, so winnings land in the
 * league wallet. Money therefore enters a league seat from the platform wallet
 * and leaves it into the league wallet — the dual-wallet isolation the spec
 * calls a critical failure, running in both directions.
 *
 * Demonstrated: give the members platform funds as well and they seat fine,
 * their PLATFORM balance dropping (500 -> 490) while the ₮30 in their league
 * wallets is untouched. The assertion below is deliberately left demanding the
 * correct behaviour — league chips seating a league player — so this passes
 * only once the buy-in is scoped.
 *
 * ON THE DUPLICATED SOCKET CLIENT
 *
 * `scripts/e2e-play.ts` has a near-identical `Client`. Extracting it into a
 * shared module is the tidier answer and is deliberately NOT done here: that
 * file is Esther's active tool for ESTHER_V2 task 3 (three commits in recent
 * days, one per game she works through), and refactoring underneath her would
 * cost a merge conflict to save some duplication in a test harness. Worth
 * extracting once her sweep is finished.
 */

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:4100';
const FC = process.env.FINANCIAL_CORE_URL ?? 'http://127.0.0.1:4001';
const INTERNAL = process.env.INTERNAL_API_SECRET ?? 'e2e-secret';
const WS_URL = GATEWAY.replace(/^http/, 'ws') + '/ws';
/** A TRON address that passes the checksum validator — deposits are refused without one. */
const ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const stamp = Date.now().toString(36);
const LEAGUE = `e2e-league-${stamp}`;

// ── plumbing ────────────────────────────────────────────────────────────────

async function http(
  base: string,
  path: string,
  init: { method?: string; body?: unknown; token?: string; internal?: boolean } = {},
): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.internal ? { 'x-internal-secret': INTERNAL } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const parsed: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const why =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : res.statusText;
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${why}`);
  }
  return parsed;
}

const gw = (path: string, init?: Parameters<typeof http>[2]): Promise<unknown> =>
  http(GATEWAY, path, init);
const fc = (path: string, init?: Parameters<typeof http>[2]): Promise<unknown> =>
  http(`${FC}/api/v1`, path, { ...init, internal: true });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(what: string, cond: () => boolean, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

interface Seat {
  index: number;
  playerId: string;
  isYou: boolean;
  stack: number;
}
interface Snapshot {
  tableId: string;
  phase: string;
  minBuyIn: number;
  maxSeats: number;
  seats: Seat[];
}

/** A table client speaking the real wire protocol: X25519 -> HKDF -> HMAC'd frames. */
class Client {
  snapshot: Snapshot | null = null;
  readonly errors: string[] = [];
  private ws!: WebSocket;
  private key!: Buffer;
  private seq = 0;

  private constructor(
    readonly playerId: string,
    readonly tableId: string,
    private readonly token: string,
  ) {}

  static connect(playerId: string, tableId: string, token: string): Promise<Client> {
    const c = new Client(playerId, tableId, token);
    return c.open().then(() => c);
  }

  private open(): Promise<void> {
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
            JSON.stringify({ t: 'client_hello', clientPublicKey: pair.publicKeyB64, token: this.token }),
          );
          return;
        }
        if (msg.t === 'ready') {
          clearTimeout(fail);
          this.send({ type: 'join', roomId: this.tableId });
          resolve();
          return;
        }
        const env = msg as unknown as { payload?: string };
        if (!env.payload) return;
        const inner = JSON.parse(env.payload) as { type: string; state?: Snapshot; message?: string };
        if (inner.type === 'state' && inner.state) this.snapshot = inner.state;
        if (inner.type === 'error' && inner.message) this.errors.push(inner.message);
      });
    });
  }

  private send(inner: unknown): void {
    const payload = JSON.stringify(inner);
    const seq = ++this.seq;
    this.ws.send(JSON.stringify({ seq, payload, mac: signMessage(this.key, seq, payload) }));
  }

  command(cmd: unknown): void {
    this.send({ type: 'action', roomId: this.tableId, action: cmd });
  }

  seat(): Seat | undefined {
    return this.snapshot?.seats.find((s) => s.isYou);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

// ── the run ─────────────────────────────────────────────────────────────────

interface Player {
  playerId: string;
  token: string;
}

async function signup(handle: string): Promise<Player> {
  const r = (await gw('/auth/signup', {
    method: 'POST',
    body: { email: `${handle}-${stamp}@e2e.test`, password: 'Demo!2345', displayName: handle },
  })) as { token: string; player: { playerId: string } };
  return { playerId: r.player.playerId, token: r.token };
}

async function balance(playerId: string, scope?: string): Promise<number> {
  const r = (await fc(
    `/internal/accounts/${encodeURIComponent(playerId)}/balance${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`,
  ).catch(() => null)) as { available?: string } | null;
  return r?.available ? Number(r.available) : 0;
}

async function main(): Promise<void> {
  const live: Client[] = [];
  try {
    console.log(`league    : ${LEAGUE}`);

    // 1. Three real accounts.
    const [owner, memberA, memberB] = await Promise.all([
      signup('owner'),
      signup('mema'),
      signup('memb'),
    ]);
    console.log(`players   : owner + 2 members`);

    // 2. The league, and its members.
    await gw('/leagues', { method: 'POST', token: owner.token, body: { leagueId: LEAGUE, name: 'E2E League' } });
    for (const m of [memberA, memberB]) {
      await gw(`/leagues/${LEAGUE}/join`, { method: 'POST', token: m.token, body: {} });
    }

    // 3. Settings. No gateway route exists for this yet — it is ops-only today,
    //    which is itself a gap worth closing, but not this script's job.
    await fc(`/internal/leagues/${LEAGUE}/settings`, {
      method: 'PUT',
      body: {
        settings: { rakeBps: 300, tableHours: 12, buyIn: 200, spectatorsAllowed: true },
        pendingRakeChange: null,
      },
    });
    console.log(`settings  : rake 3%, buy-in 200`);

    // 4. Fund TREASURY the way it really fills: rake from a platform hand.
    const [pfA, pfB] = await Promise.all([signup('pfa'), signup('pfb')]);
    for (const p of [pfA, pfB]) {
      await fc('/internal/deposits', {
        method: 'POST',
        body: {
          playerId: p.playerId,
          amount: '3000.00',
          txHash: `e2e-${stamp}-${p.playerId.slice(-6)}`,
          contractAddress: ADDRESS,
          confirmations: 25,
        },
      });
      await fc('/internal/buy-ins', { method: 'POST', body: { playerAccountId: p.playerId, amount: '2000.00' } });
    }
    await fc('/internal/table-settlements', {
      method: 'POST',
      body: {
        roundId: `e2e-pf-${stamp}`,
        tableType: 'PLATFORM',
        losers: [{ playerAccountId: pfB.playerId, amount: '2000.00' }],
        winners: [{ playerAccountId: pfA.playerId, amount: '1890.00' }],
        rake: '100.00',
        jackpot: { mini: '10.00', minor: '0', major: '0', grand: '0' },
        // `jp:<ownerId>:<tier>` — the owner is the SECOND segment, so the run
        // stamp belongs there. Four segments put every run under owner "e2e"
        // and the second run died on a duplicate-key error that looked like a
        // settlement bug.
        jackpotAccounts: {
          mini: `jp:${stamp}:mini`,
          minor: `jp:${stamp}:minor`,
          major: `jp:${stamp}:major`,
          grand: `jp:${stamp}:grand`,
        },
      },
    });
    console.log(`treasury  : funded by platform rake (₮100)`);

    // 5. Top-up TREASURY -> LEAGUE_INVENTORY, through the real three-step flow.
    const accounts = (await fc('/internal/ops/overview')) as {
      balances?: { accountType: string; total: string }[];
    };
    const treasuryId = 'treasury-1';
    void accounts;
    const req = (await fc('/internal/league-funding/top-ups', {
      method: 'POST',
      body: { leagueId: LEAGUE, amount: '80.00', requestedBy: owner.playerId },
    })) as { requestId: string };
    await fc(`/internal/league-funding/${req.requestId}/approve`, {
      method: 'POST',
      body: { approvedBy: 'ops-e2e' },
    });
    await fc(`/internal/league-funding/${req.requestId}/execute`, {
      method: 'POST',
      body: { treasuryAccountId: treasuryId, executedBy: 'ops-e2e' },
    });
    console.log(`top-up    : ₮80 -> league inventory`);

    // 6. THE PIECE THAT WAS MISSING: chips into the members' LEAGUE wallets.
    //    Without this every league buy-in fails with "insufficient available
    //    balance", forever, and no league table can ever be played at.
    for (const m of [memberA, memberB]) {
      await gw(`/leagues/${LEAGUE}/grants`, {
        method: 'POST',
        token: owner.token,
        body: { playerId: m.playerId, amount: '30.00', reference: `grant-${stamp}-${m.playerId.slice(-6)}` },
      });
    }
    console.log(`grants    : ₮30 to each member's league wallet`);

    // 7. Create the table (owner only — a member would be refused 403).
    const table = (await gw(`/leagues/${LEAGUE}/tables`, {
      method: 'POST',
      token: owner.token,
      body: { variantId: 'texas', smallBlind: 1, bigBlind: 2, maxSeats: 6, name: 'E2E Room' },
    })) as { tableId: string; rakeBps: number; rakeDestination: string };
    console.log(`table     : ${table.tableId} (rake ${table.rakeBps}bps -> ${table.rakeDestination})`);

    // 8. JOIN — the half that was never proved. WebSocket only; there is no
    //    HTTP join. If this fails, task 3 is not done.
    const before = await Promise.all([
      balance(memberA.playerId, LEAGUE),
      balance(memberB.playerId, LEAGUE),
    ]);

    for (const m of [memberA, memberB]) {
      const c = await Client.connect(m.playerId, table.tableId, m.token);
      live.push(c);
    }
    await until('both clients to receive a snapshot', () => live.every((c) => c.snapshot !== null));
    console.log(`joined    : ${live.length} clients hold a snapshot of the table`);

    // 9. Sit. Buy-in read from the table itself rather than assumed — the units
    //    the room speaks are its own business.
    const minBuyIn = live[0]!.snapshot!.minBuyIn;
    const buyIn = Math.max(minBuyIn, Math.min(minBuyIn * 5, 2_000));
    for (const [i, c] of live.entries()) {
      c.command({ kind: 'sit', seat: i, buyIn });
    }
    await until(
      'both players to be seated',
      () => live.every((c) => c.seat() !== undefined),
      15_000,
    ).catch((e: Error) => {
      // The server tells us WHY it refused; a bare timeout hides it and sends
      // the reader hunting through logs for something we were already told.
      const said = live.flatMap((c) => c.errors);
      throw new Error(
        said.length
          ? `${e.message}. The table said: ${said.join(' | ')} (tried buyIn=${buyIn}, table minBuyIn=${minBuyIn})`
          : `${e.message}. The table said nothing (tried buyIn=${buyIn}, table minBuyIn=${minBuyIn})`,
      );
    });

    const seatedNames = live.map((c) => `seat ${c.seat()!.index} (${c.seat()!.stack} chips)`);
    console.log(`SEATED    : ${seatedNames.join(', ')}`);

    // 10. The money actually left their league wallets.
    const after = await Promise.all([
      balance(memberA.playerId, LEAGUE),
      balance(memberB.playerId, LEAGUE),
    ]);
    for (const [i, m] of [memberA, memberB].entries()) {
      if (!(after[i]! < before[i]!)) {
        throw new Error(
          `${m.playerId} sat down but their league wallet did not move (${before[i]} -> ${after[i]})`,
        );
      }
    }
    console.log(`wallets   : ${before.join(', ')} -> ${after.join(', ')} (buy-in held)`);

    // 11. Isolation: a stranger must not be able to open this league's tables.
    const stranger = await signup('stranger');
    let refused = false;
    await gw(`/leagues/${LEAGUE}/tables`, {
      method: 'POST',
      token: stranger.token,
      body: { variantId: 'texas', smallBlind: 1, bigBlind: 2 },
    }).catch((e: Error) => {
      refused = /404|no such league/i.test(e.message);
    });
    if (!refused) throw new Error('a non-member was able to open a table in this league');
    console.log(`isolation : a non-member is refused (404, no existence leak)`);

    console.log('\n  E2E LEAGUE: PASS — a player created a private table and sat down at it.');
  } finally {
    for (const c of live) {
      try {
        c.command({ kind: 'stand' });
      } catch {
        /* already gone */
      }
    }
    await sleep(500);
    for (const c of live) c.close();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('\n  E2E LEAGUE FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
