/**
 * Runnable Texas Hold'em demo — plays one full provably-fair hand end-to-end and prints it.
 *
 *   npm run texas-demo
 *
 * Shows: the provably-fair inputs (server/client/future-block seeds → final seed), the deal, every
 * action street by street, the showdown, the money settlement (rake + 0.5% jackpot), the exact
 * request sent to the Financial Core, and a 6-step verification of the deal.
 */
import {
  generateServerCommitment,
  generateClientSeed,
  mergeClientSeeds,
  computeFinalSeed,
  computeRoundHash,
  shuffledDeck,
  FakeChainClient,
  MerkleAggregator,
  InMemoryMerkleStore,
  verifyRound,
  type SeatedClientSeed,
} from '../src/fairness';
import {
  TexasHand,
  computeSettlement,
  toTableSettlementRequest,
  CATEGORY_NAME,
  type Action,
} from '../src/games/texas';

const line = (s = ''): void => console.log(s);
const hr = (): void => line('─'.repeat(64));

async function main(): Promise<void> {
  const roundId = 'demo-round-1';
  const players = [
    { id: 'alice', stack: 1000 },
    { id: 'bob', stack: 1000 },
    { id: 'carol', stack: 1000 },
  ];

  // ── 1. Provably-fair round inputs ──────────────────────────────────────────────
  const { serverSeed, serverCommit } = generateServerCommitment();
  const seats: SeatedClientSeed[] = players.map((_, i) => ({
    seatOrder: i,
    clientSeed: generateClientSeed(),
  }));
  const allClientSeeds = mergeClientSeeds(seats);
  const chain = new FakeChainClient();
  const targetBlock = (await chain.getLatestBlockNumber()) + 1;
  const futureBlockHash = await chain.getBlockHash(targetBlock);
  const finalSeed = computeFinalSeed(serverSeed, allClientSeeds, futureBlockHash, roundId);

  hr();
  line('FairPlay — Texas Hold\'em hand (provably fair)');
  hr();
  line(`server commit : ${serverCommit.slice(0, 24)}…`);
  line(`client seeds  : ${seats.length} players contributed`);
  line(`future block  : #${targetBlock} ${futureBlockHash.slice(0, 16)}…`);
  line(`final seed    : ${finalSeed.slice(0, 24)}…  (no one could predict this before the deal)`);

  // ── 2. Deal ─────────────────────────────────────────────────────────────────────
  const hand = new TexasHand(players, { seed: finalSeed, smallBlind: 5, bigBlind: 10 });
  line('');
  line('Hole cards:');
  for (const p of players) line(`  ${p.id.padEnd(6)} ${hand.holeCardsFor(p.id)!.join(' ')}`);
  line(`Blinds posted — pot ${hand.pot}`);

  // ── 3. Play (scripted: one preflop raise, then checks to showdown) ───────────────
  line('');
  line('PREFLOP');
  let raised = false;
  let lastStreet = hand.street;
  while (!hand.isComplete) {
    const actor = hand.toAct!;
    const la = hand.legalActions();
    let action: Action;
    if (hand.street === 'PREFLOP' && !raised && la.minRaiseTo !== null) {
      action = { type: 'raise', amount: la.minRaiseTo };
      raised = true;
    } else if (la.canCheck) {
      action = { type: 'check' };
    } else {
      action = { type: 'call' };
    }
    const label =
      action.type === 'raise' ? `raise to ${action.amount}` : action.type;
    hand.act(actor, action);
    line(`  ${actor.padEnd(6)} ${label}`);
    if (hand.street !== lastStreet && !hand.isComplete) {
      lastStreet = hand.street;
      line(`${hand.street}  [ ${hand.community().join(' ')} ]`);
    }
  }

  // ── 4. Showdown + result ─────────────────────────────────────────────────────────
  const res = hand.getResult()!;
  line('');
  line(`Board: ${res.community.join(' ') || '(none — won before showdown)'}`);
  if (res.showdown.length) {
    line('Showdown:');
    for (const s of res.showdown) {
      line(`  ${s.id.padEnd(6)} ${s.hole.join(' ')}  →  ${CATEGORY_NAME[s.rank.category]}`);
    }
  }
  line('');
  line('Gross pot payouts:');
  for (const [id, amt] of res.payouts) line(`  ${id.padEnd(6)} +${amt}`);

  // ── 5. Money settlement (rake + jackpot) ──────────────────────────────────────────
  const settlement = computeSettlement({
    payouts: res.payouts,
    contributions: hand.contributions(),
    rake: { bps: 500, cap: 10000, noFlopNoDrop: true },
    flopSeen: res.community.length >= 3,
  });
  hr();
  line('Settlement');
  line(`  rake to house : ${settlement.rake}`);
  line(
    `  jackpot (0.5%): ${settlement.jackpotTotal}  ` +
      `(mini ${settlement.jackpot.mini} / minor ${settlement.jackpot.minor} / ` +
      `major ${settlement.jackpot.major} / grand ${settlement.jackpot.grand})`,
  );
  for (const w of settlement.winners) line(`  ${w.playerId.padEnd(6)} net +${w.amount}`);
  for (const l of settlement.losers) line(`  ${l.playerId.padEnd(6)} net -${l.amount}`);

  const fcRequest = toTableSettlementRequest(settlement, {
    roundId,
    tableType: 'PLATFORM',
    accountOf: (p) => `acc-${p}`,
    jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
  });
  line('');
  line('→ Financial Core request (POST /internal/table-settlements):');
  line(`  losers : ${fcRequest.losers.map((l) => `${l.playerAccountId}=${l.amount}`).join(', ')}`);
  line(`  winners: ${fcRequest.winners.map((w) => `${w.playerAccountId}=${w.amount}`).join(', ')}`);
  line(`  rake=${fcRequest.rake}  jackpot.grand=${fcRequest.jackpot.grand}`);

  // ── 6. Provably-fair verification (the 6 steps anyone can run) ─────────────────────
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
  const v = verifyRound({
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
  });
  hr();
  line(
    v.allPass
      ? '✅ Provably fair: all 6 verification steps passed (deck is verifiable & untampered).'
      : '❌ Verification FAILED',
  );
  hr();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
