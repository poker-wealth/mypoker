import { EventBus } from '../src/core/event-bus';
import { FakeChainClient } from '../src/fairness';
import type { FinancialCoreClient, TableSettlementRequest } from '../src/core/financial-core-client';

import { TexasGame } from '../src/games/texas/texas-game';
import { TexasHand } from '../src/games/texas/texas-hand';
import { SHORT_DECK, OMAHA } from '../src/games/texas/variants';
import { BaccaratGame } from '../src/games/baccarat/baccarat-game';
import { SanZhangGame } from '../src/games/san-zhang/san-zhang-game';
import { NiuNiuGame } from '../src/games/niu-niu/niu-niu-game';
import { RedPacketGame } from '../src/games/red-packet/red-packet-game';
import { CowboyBeautyGame } from '../src/games/cowboy-beauty/cowboy-beauty-game';
import { LotteryGame } from '../src/games/lottery/lottery-game';
import { SlotsProvider } from '../src/games/slots/slots-provider';
import { ThirdPartyAdapter } from '../src/games/third-party/adapter';
import { JackpotEngine } from '../src/jackpot/jackpot-engine';
import { usd } from '../src/jackpot/tiers';

/**
 * Plays every game once and shows the money. For each hand it prints who won, who paid, our rake —
 * and checks the rule that must never break:
 *
 *     what the losers pay  =  what the winners get  +  rake  +  jackpot
 *
 * Run with:  npm run demo
 */

const G = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const X = '\x1b[0m';

let lastRequest: TableSettlementRequest | undefined;
const fc: FinancialCoreClient = {
  async buyIn() {},
  async release() {},
  async settleRound(req) {
    return { roundId: req.roundId, sequence: [], amounts: { jackpot: '0', rake: '0', payout: '0' }, accounts: {}, hash: '' };
  },
  async settleTableHand(req) {
    lastRequest = req;
    return { roundId: req.roundId, applied: true };
  },
};

const base = {
  rakeBps: 500, // 5% — our only income
  tableType: 'PLATFORM' as const,
  accountOf: (p: string): string => `acc-${p}`,
  jackpotAccounts: { mini: 'jm', minor: 'jn', major: 'jj', grand: 'jg' },
};

let passed = 0;
let failed = 0;

function report(game: string, detail: string): void {
  const req = lastRequest;
  console.log(`\n${B}${game}${X}`);
  console.log(`  ${D}${detail}${X}`);

  if (!req) {
    console.log(`  ${D}round void — no money moved (a tie, or nobody won)${X}`);
    passed++;
    return;
  }

  const paidIn = req.losers.reduce((a, l) => a + Number(l.amount), 0);
  const paidOut = req.winners.reduce((a, w) => a + Number(w.amount), 0);
  const rake = Number(req.rake);
  const jp =
    Number(req.jackpot.mini) + Number(req.jackpot.minor) + Number(req.jackpot.major) + Number(req.jackpot.grand);

  for (const w of req.winners) console.log(`  ${G}+${w.amount}${X}  ${w.playerAccountId.replace('acc-', '')}`);
  for (const l of req.losers) console.log(`  ${R}-${l.amount}${X}  ${l.playerAccountId.replace('acc-', '')}`);
  console.log(`  ${D}rake to us: ${rake}   jackpot: ${jp}${X}`);

  const ok = paidIn === paidOut + rake + jp;
  if (ok) {
    console.log(`  ${G}✅ balances: ${paidIn} paid in = ${paidOut} won + ${rake} rake + ${jp} jackpot${X}`);
    passed++;
  } else {
    console.log(`  ${R}❌ DOES NOT BALANCE: ${paidIn} in vs ${paidOut + rake + jp} out${X}`);
    failed++;
  }
  lastRequest = undefined;
}

async function main(): Promise<void> {
  console.log(`${B}\nFairPlay — playing every game, checking every cent${X}`);
  console.log('─'.repeat(66));

  // ── Texas Hold'em ─────────────────────────────────────────────────────────
  {
    const g = new TexasGame(
      't', fc, new EventBus(),
      { ...base, smallBlind: 10, bigBlind: 20, rake: { bps: 500, cap: 100_000, noFlopNoDrop: true } },
      new FakeChainClient(),
    );
    await g.seatPlayer('alice', 1000);
    await g.seatPlayer('bob', 1000);
    await g.seatPlayer('carol', 1000);
    await g.startHand();
    let guard = 0;
    while (g.legalActions() && guard++ < 100) {
      const actor = (g.getPublicState('alice') as { toAct?: string | null }).toAct;
      if (!actor) break;
      const legal = g.legalActions()!;
      await g.handleAction(actor, legal.canCheck ? { type: 'check' } : { type: 'call' });
    }
    report("Texas Hold'em", '3 players, everyone to showdown');
  }

  // ── Short Deck & Omaha (share Texas's betting + money path) ────────────────
  for (const v of [SHORT_DECK, OMAHA]) {
    const players = [
      { id: 'alice', stack: 1000 },
      { id: 'bob', stack: 1000 },
    ];
    const h = new TexasHand(players, { smallBlind: 10, bigBlind: 20, seed: `demo-${v.id}`, variant: v });
    while (!h.isComplete && h.toAct) {
      const legal = h.legalActions();
      h.act(h.toAct, legal.canCheck ? { type: 'check' } : { type: 'call' });
    }
    const res = h.getResult()!;
    const paid = [...res.payouts.values()].reduce((a, b) => a + b, 0);
    console.log(`\n${B}${v.name}${X}`);
    console.log(`  ${D}board ${res.community.join(' ')}${X}`);
    for (const s of res.showdown) {
      console.log(`  ${D}${s.id.padEnd(6)} ${s.hole.join(' ').padEnd(14)} → ${s.rank.cards.join(' ')}${X}`);
    }
    const ok = paid === h.pot;
    console.log(
      ok
        ? `  ${G}✅ every chip paid out: pot ${h.pot} = ${paid} to winners${X}`
        : `  ${R}❌ pot ${h.pot} but paid ${paid}${X}`,
    );
    if (ok) passed++;
    else failed++;
  }

  // ── Baccarat (a PLAYER banks — never us) ───────────────────────────────────
  {
    const g = new BaccaratGame('t', fc, new EventBus(), new FakeChainClient(), { ...base, tiePayout: 8 });
    g.setBanker('banker-bob');
    g.placeBet('alice', 'player', 100);
    g.placeBet('carol', 'banker', 100);
    await g.start();
    report('Baccarat', `a player banks it, not us — outcome: ${g.getResult()?.outcome}`);
  }

  // ── San Zhang ──────────────────────────────────────────────────────────────
  {
    const g = new SanZhangGame('t', fc, new EventBus(), new FakeChainClient(), base);
    g.setBanker('banker-bob');
    g.placeBet('alice', 100);
    g.placeBet('carol', 100);
    await g.start();
    report('San Zhang', 'a player banks it');
  }

  // ── Niu Niu ────────────────────────────────────────────────────────────────
  {
    const g = new NiuNiuGame('t', fc, new EventBus(), new FakeChainClient(), base);
    g.claimBanker('banker-bob');
    g.placeBet('alice', 100);
    g.placeBet('carol', 100);
    g.placeBet('dave', 100);
    await g.start();
    report('Niu Niu', 'a player banks it');
  }

  // ── Red Packet Minesweeper ─────────────────────────────────────────────────
  {
    const g = new RedPacketGame('t', fc, new EventBus(), {
      ...base, size: 25, mineCount: 5, serverSeed: 'demo-seed',
    });
    console.log(`\n${D}(grid committed BEFORE bets: ${g.getCommit().slice(0, 24)}…)${X}`);
    g.setBanker('banker-bob');
    g.placeBet('alice', 0, 100);
    g.placeBet('carol', 1, 100);
    g.placeBet('dave', 2, 100);
    await g.start();
    const rev = g.reveal()!;
    report('Red Packet Minesweeper', `mines were at ${rev.mines.join(',')} — fixed before anyone bet`);
  }

  // ── Cowboy & Beauty ────────────────────────────────────────────────────────
  {
    const g = new CowboyBeautyGame('t', fc, new EventBus(), new FakeChainClient(), base);
    g.placeBet('alice', 'COWBOY', 150);
    g.placeBet('bob', 'BEAUTY', 250);
    await g.freeze();
    const odds = g.getOddsBps();
    await g.start();
    report(
      'Cowboy & Beauty',
      `odds froze at ${(odds.COWBOY! / 10000).toFixed(2)}x / ${(odds.BEAUTY! / 10000).toFixed(2)}x → ${g.getWinner()} won`,
    );
  }

  // ── Lottery ────────────────────────────────────────────────────────────────
  {
    const g = new LotteryGame('t', fc, new EventBus(), new FakeChainClient(), { ...base, range: 5 });
    for (let n = 0; n < 5; n++) g.buyTicket(`p${n}`, n, 100);
    await g.start();
    report('Lottery', `winning number ${g.getWinningNumber()} — prize is the players' own pool`);
  }

  // ── Slots (outside vendor, behind our wall) ────────────────────────────────
  {
    const SECRET = 'demo-secret';
    const adapter = new ThirdPartyAdapter(fc, {
      provider: new SlotsProvider(SECRET, 'demo-seed'),
      secret: SECRET,
      providerAccountId: 'acc-vendor',
      maxPayoutMultiple: 100,
      commissionBps: 500,
      tableType: 'PLATFORM',
      accountOf: (p: string): string => `acc-${p}`,
      jackpotAccounts: base.jackpotAccounts,
    });
    let spins = 0;
    let r;
    do {
      r = await adapter.play('alice', `spin-${spins++}`, 100);
    } while (r.net === 0 && spins < 50);
    const reels = (r.outcome as { reels: string[] }).reels;
    report('Slots (vendor)', `reels ${reels.join(' ')} — vendor can never touch our money`);
  }

  // ── Jackpot engine ─────────────────────────────────────────────────────────
  {
    const e = new JackpotEngine('demo-table');
    e.inject(usd(50_000)); // 0.5% of winners' profit
    console.log(`\n${B}Jackpot engine${X}`);
    console.log(`  ${D}pools — mini $${e.pool('MINI') / 1e6} / minor $${e.pool('MINOR') / 1e6} / major $${e.pool('MAJOR') / 1e6} / grand $${e.pool('GRAND') / 1e6}${X}`);
    const players = [
      { playerId: 'alice', baseWeight: 10, behavior: 'NORMAL' as const, associated: false },
      { playerId: 'cheat', baseWeight: 999, behavior: 'COLLUDING' as const, associated: false },
    ];
    let hit;
    for (let i = 1; i <= 40 && !hit; i++) {
      hit = e.onRoundSettled({ roundId: `r${i}`, seed: 'demo', now: Date.now(), candidates: players })[0];
    }
    if (hit) {
      console.log(`  ${G}🎰 ${hit.tier} jackpot → ${hit.playerId} won $${(hit.amount / 1e6).toFixed(2)}${X}`);
      const cheatWon = hit.playerId === 'cheat';
      console.log(
        cheatWon
          ? `  ${R}❌ a confirmed colluder won — weighting is broken${X}`
          : `  ${G}✅ the colluder (weight 999, but flagged) won NOTHING${X}`,
      );
      if (cheatWon) failed++;
      else passed++;
    }
  }

  console.log('\n' + '─'.repeat(66));
  const all = failed === 0;
  console.log(
    all
      ? `${B}${G}RESULT: ${passed} passed, 0 failed — every game balances to the cent.${X}\n`
      : `${B}${R}RESULT: ${passed} passed, ${failed} FAILED${X}\n`,
  );
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
