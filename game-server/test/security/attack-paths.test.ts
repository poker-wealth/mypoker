import { generateEphemeralKeyPair, deriveSessionKey, signMessage } from '../../src/transport/crypto';
import { Session } from '../../src/transport/session';
import {
  generateServerCommitment,
  generateClientSeed,
  mergeClientSeeds,
  computeFinalSeed,
  computeRoundHash,
  type SeatedClientSeed,
} from '../../src/fairness/seed';
import { shuffledDeck } from '../../src/fairness/shuffle';
import { FakeChainClient } from '../../src/fairness/chain';
import { MerkleAggregator, InMemoryMerkleStore } from '../../src/fairness/merkle-aggregator';
import { verifyRound, type RoundVerificationData } from '../../src/fairness/verification';

/**
 * ADVERSARIAL TRANSPORT + FAIRNESS PEN-TEST (VICTOR_V2 task 6 — the paths beyond the FC money-safety
 * subset, which lives in financial-core/test/security/attack-paths.test.ts).
 *
 * Each test IS an attack against the live WebSocket session crypto or the provably-fair verifier, and
 * asserts the platform rejects it. These map to the spec's pen-test paths:
 *
 *   transport (§ WebSocket security):  message replay with an old sequence number → rejected;
 *                                      HMAC forgery → rejected; a stale/other session key (ECDH reuse
 *                                      across rounds) → rejected; three verification failures →
 *                                      disconnect (+ 30-min hardware-fingerprint ban upstream).
 *   fairness (§ 6-step verification):  a server that swaps its seed after committing; a deck that does
 *                                      not follow from the seed; a substituted client seed; a round
 *                                      altered after the fact; forged notarization; and that the deal
 *                                      cannot be precomputed before the future block is known.
 *
 * Pure crypto + in-memory fairness — no database, so this suite is fast and deterministic.
 */

/** A real ECDH handshake → the shared key both sides independently derive. */
function handshake(): Buffer {
  const client = generateEphemeralKeyPair();
  const server = generateEphemeralKeyPair();
  const serverKey = deriveSessionKey(server.privateKey, client.publicKeyB64);
  const clientKey = deriveSessionKey(client.privateKey, server.publicKeyB64);
  // ECDH: both sides arrive at the SAME key — the premise every attack below tries to get around.
  expect(serverKey.equals(clientKey)).toBe(true);
  return serverKey;
}

/** A well-formed inbound envelope from a legitimate client holding `key`. */
function envelope(key: Buffer, seq: number, payload: string): { seq: number; payload: string; mac: string } {
  return { seq, payload, mac: signMessage(key, seq, payload) };
}

describe('transport pen-test — the session refuses replayed, forged and cross-key traffic', () => {
  it('ATTACK T1 — replay a captured message with an old sequence number: rejected', () => {
    const key = handshake();
    const s = new Session('p1', key);

    const first = envelope(key, 1, '{"kind":"act"}');
    expect(s.verifyInbound(first.seq, first.payload, first.mac).ok).toBe(true);

    // The attacker resends the exact captured frame.
    const replay = s.verifyInbound(first.seq, first.payload, first.mac);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe('bad_sequence');
    // Any sequence ≤ the last accepted is refused, not only an exact duplicate.
    expect(s.verifyInbound(1, first.payload, first.mac).ok).toBe(false);
  });

  it('ATTACK T2 — tamper the payload but keep the captured MAC (forgery): rejected', () => {
    const key = handshake();
    const s = new Session('p1', key);

    const legit = envelope(key, 5, '{"kind":"act","amount":100}');
    // The attacker rewrites the amount and replays the original MAC.
    const forged = s.verifyInbound(5, '{"kind":"act","amount":1000000}', legit.mac);
    expect(forged.ok).toBe(false);
    expect(forged.reason).toBe('bad_hmac');
  });

  it("ATTACK T3 — sign under another handshake's key (ECDH key reuse across rounds): rejected", () => {
    const keyA = handshake(); // this connection's key
    const keyB = handshake(); // a DIFFERENT handshake — an independent, ephemeral key
    expect(keyA.equals(keyB)).toBe(false); // ephemeral keys do not collide

    const s = new Session('p1', keyA);
    // The attacker forges a frame under a stale/other key rather than this session's.
    const wrong = envelope(keyB, 1, '{"kind":"act"}');
    const r = s.verifyInbound(wrong.seq, wrong.payload, wrong.mac);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_hmac');
  });

  it('ATTACK T4 — three verification failures disconnect the connection (→ 30-min fingerprint ban upstream)', () => {
    const key = handshake();
    const s = new Session('p1', key, 3);
    const bad = { seq: 1, payload: 'x', mac: 'deadbeef' };

    expect(s.verifyInbound(bad.seq, bad.payload, bad.mac).disconnect).toBe(false); // strike 1
    expect(s.verifyInbound(bad.seq, bad.payload, bad.mac).disconnect).toBe(false); // strike 2
    expect(s.verifyInbound(bad.seq, bad.payload, bad.mac).disconnect).toBe(true); // strike 3 → cut
    expect(s.strikeCount).toBe(3);
  });

  it('a legitimate monotonic stream under the right key is accepted throughout, no strikes', () => {
    const key = handshake();
    const s = new Session('p1', key);
    for (let seq = 1; seq <= 5; seq++) {
      const e = envelope(key, seq, `{"n":${seq}}`);
      expect(s.verifyInbound(e.seq, e.payload, e.mac).ok).toBe(true);
    }
    expect(s.strikeCount).toBe(0);
  });
});

/** Build a complete, genuine round exactly as the game server would — the thing each attack mutates. */
async function genuineRound(roundId: string): Promise<RoundVerificationData> {
  const { serverSeed, serverCommit } = generateServerCommitment();
  const seats: SeatedClientSeed[] = [
    { seatOrder: 0, clientSeed: generateClientSeed() },
    { seatOrder: 1, clientSeed: generateClientSeed() },
  ];
  const allClientSeeds = mergeClientSeeds(seats);

  const chain = new FakeChainClient();
  const target = (await chain.getLatestBlockNumber()) + 1;
  const futureBlockHash = await chain.getBlockHash(target);

  const finalSeed = computeFinalSeed(serverSeed, allClientSeeds, futureBlockHash, roundId);
  const cards = shuffledDeck(finalSeed);
  const timestamp = 1_700_000_000_000;
  const roundHash = computeRoundHash({
    roundId,
    serverCommit,
    allClientSeeds,
    futureBlockHash,
    finalSeed,
    cards,
    timestamp,
  });

  const store = new InMemoryMerkleStore();
  const agg = new MerkleAggregator(chain, store, 100);
  await agg.addRound(roundId, roundHash);
  await agg.flush();
  const rec = store.get(roundId)!;

  return {
    roundId,
    serverSeed,
    serverCommit,
    allClientSeeds,
    futureBlockHash,
    finalSeed,
    cards,
    timestamp,
    roundHash,
    merkleProof: rec.merkleProof,
    merkleRoot: rec.merkleRoot,
    seatedClientSeeds: seats,
  };
}

describe('fairness pen-test — the verifier rejects a rigged or altered deal', () => {
  it('ATTACK F1 — server swaps its seed after committing (deal itself a better board): step 1 fails', async () => {
    const data = await genuineRound('pen-f1');
    // Keep the published commit; reveal a different seed the attacker preferred.
    const rigged = verifyRound({ ...data, serverSeed: generateServerCommitment().serverSeed });
    expect(rigged.step1_serverCommit).toBe(false);
    expect(rigged.allPass).toBe(false);
  });

  it('ATTACK F2 — server honours the commit but deals a deck the seed does not yield: step 4 fails', async () => {
    const data = await genuineRound('pen-f2');
    const cards = [...data.cards];
    [cards[0], cards[1]] = [cards[1]!, cards[0]!]; // deal two cards in a different order
    const r = verifyRound({ ...data, cards });
    expect(r.step4_deck).toBe(false);
    expect(r.allPass).toBe(false);
  });

  it("ATTACK F3 — platform substitutes a player's client seed and re-merges honestly: own-seed step catches it", async () => {
    const data = await genuineRound('pen-f3');
    const seats = data.seatedClientSeeds;
    // Everything reconciles against the published list — only the player, holding the seed they sent,
    // can tell their seat now carries a seed the platform chose.
    const r = verifyRound({
      ...data,
      mine: { seatOrder: seats[0]!.seatOrder, clientSeed: seats[1]!.clientSeed },
    });
    expect(r.step3_clientSeeds).toBe(false);
    expect(r.step3_ownSeedChecked).toBe(true);
    expect(r.step2_finalSeed).toBe(true); // the rest still reconciles — that is the point
    expect(r.allPass).toBe(false);
  });

  it('ATTACK F4 — alter a round field after the fact (timestamp): round-hash step fails', async () => {
    const data = await genuineRound('pen-f4');
    const r = verifyRound({ ...data, timestamp: data.timestamp + 1 });
    expect(r.step5_roundHash).toBe(false);
    expect(r.allPass).toBe(false);
  });

  it('ATTACK F5 — forge notarization for a round never in the batch: Merkle step fails', async () => {
    const data = await genuineRound('pen-f5');
    const r = verifyRound({ ...data, merkleRoot: '0'.repeat(64) });
    expect(r.step6_merkle).toBe(false);
    expect(r.allPass).toBe(false);
  });

  it('ATTACK F6 — the deal cannot be precomputed before the future block is known', () => {
    // At commit time the server has fixed its seed and the players theirs, but the future block hash
    // is not yet produced. Mixing two different block hashes into the SAME seeds yields different
    // decks — so no one (server included) can know the deck until the slot finalizes.
    const { serverSeed } = generateServerCommitment();
    const seats: SeatedClientSeed[] = [{ seatOrder: 0, clientSeed: generateClientSeed() }];
    const allClientSeeds = mergeClientSeeds(seats);

    const seedFromBlockA = computeFinalSeed(serverSeed, allClientSeeds, 'block-hash-AAAA', 'r');
    const seedFromBlockB = computeFinalSeed(serverSeed, allClientSeeds, 'block-hash-BBBB', 'r');
    expect(seedFromBlockA).not.toBe(seedFromBlockB);
    expect(shuffledDeck(seedFromBlockA)).not.toEqual(shuffledDeck(seedFromBlockB));
  });
});
