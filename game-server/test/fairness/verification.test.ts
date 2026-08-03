import {
  generateServerCommitment,
  generateClientSeed,
  mergeClientSeeds,
  computeFinalSeed,
  computeRoundHash,
  type SeatedClientSeed,
} from '../../src/fairness/seed';
import { shuffledDeck, shuffle } from '../../src/fairness/shuffle';
import { shortDeck } from '../../src/games/texas/variants';
import { FakeChainClient } from '../../src/fairness/chain';
import { MerkleAggregator, InMemoryMerkleStore } from '../../src/fairness/merkle-aggregator';
import { verifyRound, type RoundVerificationData } from '../../src/fairness/verification';

/** Build a complete, real round end-to-end exactly as the game server would. */
async function buildRound(roundId: string): Promise<RoundVerificationData> {
  const { serverSeed, serverCommit } = generateServerCommitment();
  const seats: SeatedClientSeed[] = [
    { seatOrder: 0, clientSeed: generateClientSeed() },
    { seatOrder: 1, clientSeed: generateClientSeed() },
    { seatOrder: 2, clientSeed: generateClientSeed() },
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

  // Notarize via the Merkle aggregator and read back the stored proof.
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

describe('6-step provably-fair verification', () => {
  it('a genuine round passes all six steps', async () => {
    const data = await buildRound('round-1');
    const r = verifyRound(data);
    expect(r).toMatchObject({
      step1_serverCommit: true,
      step2_finalSeed: true,
      step3_clientSeeds: true,
      step4_deck: true,
      step5_roundHash: true,
      step6_merkle: true,
      allPass: true,
    });
  });

  it('detects a swapped server commit (step 1)', async () => {
    const data = await buildRound('round-2');
    const r = verifyRound({ ...data, serverCommit: 'f'.repeat(64) });
    expect(r.step1_serverCommit).toBe(false);
    expect(r.allPass).toBe(false);
  });

  it('detects tampered cards (steps 4 + 5)', async () => {
    const data = await buildRound('round-3');
    const cards = [...data.cards];
    [cards[0], cards[1]] = [cards[1]!, cards[0]!]; // swap two dealt cards
    const r = verifyRound({ ...data, cards });
    expect(r.step4_deck).toBe(false);
    expect(r.step5_roundHash).toBe(false);
    expect(r.allPass).toBe(false);
  });

  it('detects a client seed that was ignored / altered (step 3)', async () => {
    const data = await buildRound('round-4');
    const tamperedSeats = [...data.seatedClientSeeds];
    tamperedSeats[0] = { seatOrder: 0, clientSeed: generateClientSeed() }; // a different seed
    const r = verifyRound({ ...data, seatedClientSeeds: tamperedSeats });
    expect(r.step3_clientSeeds).toBe(false);
    expect(r.allPass).toBe(false);
  });

  it('detects a forged Merkle root (step 6)', async () => {
    const data = await buildRound('round-5');
    const r = verifyRound({ ...data, merkleRoot: '0'.repeat(64) });
    expect(r.step6_merkle).toBe(false);
    expect(r.allPass).toBe(false);
  });
});

describe('variant decks — step 4 checks the deck that was ACTUALLY dealt', () => {
  /** Build a round dealt from an arbitrary deck builder (e.g. a variant's 36-card short deck). */
  async function buildVariantRound(
    roundId: string,
    deckFor: (seed: string) => string[],
  ): Promise<RoundVerificationData> {
    const base = await buildRound(roundId);
    const cards = deckFor(base.finalSeed);
    const roundHash = computeRoundHash({
      roundId,
      serverCommit: base.serverCommit,
      allClientSeeds: base.allClientSeeds,
      futureBlockHash: base.futureBlockHash,
      finalSeed: base.finalSeed,
      cards,
      timestamp: base.timestamp,
    });
    const chain = new FakeChainClient();
    const store = new InMemoryMerkleStore();
    const agg = new MerkleAggregator(chain, store, 100);
    await agg.addRound(roundId, roundHash);
    await agg.flush();
    const rec = store.get(roundId)!;
    return {
      ...base,
      cards,
      roundHash,
      merkleProof: rec.merkleProof,
      merkleRoot: rec.merkleRoot,
      deckFor,
    };
  }

  it('verifies a Short Deck round against its own 36-card deck', async () => {
    const shortDeckFor = (seed: string): string[] => shuffle(shortDeck(), seed);
    const round = await buildVariantRound('sd-round', shortDeckFor);
    expect(round.cards).toHaveLength(36);

    const result = verifyRound(round);
    expect(result.step4_deck).toBe(true);
    expect(result.allPass).toBe(true);
  });

  it('REJECTS a short-deck round checked against the standard 52-card deck', async () => {
    // Without the variant builder, step 4 compares against a 52-card shuffle — and must fail.
    const shortDeckFor = (seed: string): string[] => shuffle(shortDeck(), seed);
    const round = await buildVariantRound('sd-round-2', shortDeckFor);
    const { deckFor: _omitted, ...withoutBuilder } = round;

    expect(verifyRound(withoutBuilder).step4_deck).toBe(false);
  });

  it('still catches a tampered deck when a variant builder is supplied', async () => {
    const shortDeckFor = (seed: string): string[] => shuffle(shortDeck(), seed);
    const round = await buildVariantRound('sd-round-3', shortDeckFor);
    // Swap two cards — the deck no longer matches what the seed derives.
    const tampered = { ...round, cards: [...round.cards] };
    [tampered.cards[0], tampered.cards[1]] = [tampered.cards[1]!, tampered.cards[0]!];

    expect(verifyRound(tampered).step4_deck).toBe(false);
    expect(verifyRound(tampered).allPass).toBe(false);
  });

  it('defaults to the standard 52-card deck when no builder is given', async () => {
    const round = await buildRound('std-round');
    expect(round.cards).toHaveLength(52);
    expect(verifyRound(round).allPass).toBe(true);
  });
});
