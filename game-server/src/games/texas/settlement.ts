/**
 * Texas hand → money settlement.
 *
 * Turns a finished hand (per-player payouts + contributions, in chips) into the exact money
 * movements the Financial Core applies: each loser's net loss, each winner's net gain, the rake to
 * the house, and the 0.5% jackpot injection (split 20/30/25/25). Everything is integer chips and is
 * conserved: Σ(loser losses) = Σ(winner gains) + rake + jackpot.
 *
 *   - Rake: a basis-point cut of the pot, capped, with optional "no flop, no drop".
 *   - Jackpot: 0.5% of total winner PROFIT (winners pay it; losers never do).
 *   The house cut is deducted from winners proportionally (rake by winnings, jackpot by profit).
 */

import type {
  JackpotAccounts,
  TableSettlementRequest,
} from '../../core/financial-core-client';

const JACKPOT_RATE_BP = 50n; // 0.5%
const MINI_BP = 2000n;
const MINOR_BP = 3000n;
const MAJOR_BP = 2500n;

export interface RakeConfig {
  /** Rake in basis points (e.g. 500 = 5%). */
  bps: number;
  /** Maximum rake per hand, in chips. */
  cap: number;
  /** If true and no flop was dealt, rake is zero. */
  noFlopNoDrop?: boolean;
}

export interface JackpotSplit {
  mini: number;
  minor: number;
  major: number;
  grand: number;
}

export interface PartyDelta {
  playerId: string;
  amount: number;
}

export interface TableSettlement {
  losers: PartyDelta[];
  winners: PartyDelta[];
  rake: number;
  jackpotTotal: number;
  jackpot: JackpotSplit;
}

export interface SettlementInput {
  payouts: Map<string, number>;
  contributions: Map<string, number>;
  rake: RakeConfig;
  flopSeen: boolean;
}

export function computeRake(grossPot: number, cfg: RakeConfig, flopSeen: boolean): number {
  if (cfg.noFlopNoDrop && !flopSeen) return 0;
  return Math.min(Math.floor((grossPot * cfg.bps) / 10000), cfg.cap);
}

/** Split a jackpot total 20/30/25/25, remainder to Grand so the parts sum exactly. */
export function splitJackpot(total: number): JackpotSplit {
  const t = BigInt(total);
  const mini = Number((t * MINI_BP) / 10000n);
  const minor = Number((t * MINOR_BP) / 10000n);
  const major = Number((t * MAJOR_BP) / 10000n);
  return { mini, minor, major, grand: total - mini - minor - major };
}

/** Distribute `total` across weighted items with the largest-remainder method (sums exactly). */
function allocateProportional(total: number, weights: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const sumW = [...weights.values()].reduce((s, w) => s + w, 0);
  if (total === 0 || sumW === 0) return out;

  const fractions: { id: string; frac: number }[] = [];
  let assigned = 0;
  for (const [id, w] of weights) {
    const exact = (w / sumW) * total;
    const base = Math.floor(exact);
    out.set(id, base);
    assigned += base;
    fractions.push({ id, frac: exact - base });
  }
  // Hand out the remaining chips to the largest fractional parts.
  const remainder = total - assigned;
  fractions.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder; i++) {
    const id = fractions[i % fractions.length]!.id;
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

export function computeSettlement(input: SettlementInput): TableSettlement {
  const players = new Set<string>([...input.contributions.keys(), ...input.payouts.keys()]);
  const payout = (p: string): number => input.payouts.get(p) ?? 0;
  const contrib = (p: string): number => input.contributions.get(p) ?? 0;

  const grossPot = [...input.contributions.values()].reduce((s, v) => s + v, 0);
  const rake = computeRake(grossPot, input.rake, input.flopSeen);

  // Winner profit drives the jackpot; only positive profits count.
  const profitWeights = new Map<string, number>();
  let totalProfit = 0;
  for (const p of players) {
    const profit = Math.max(0, payout(p) - contrib(p));
    if (profit > 0) {
      profitWeights.set(p, profit);
      totalProfit += profit;
    }
  }
  const jackpotTotal = Math.floor((totalProfit * Number(JACKPOT_RATE_BP)) / 10000);

  // Rake is borne by winners in proportion to winnings; jackpot in proportion to profit.
  const payoutWeights = new Map<string, number>();
  for (const p of players) if (payout(p) > 0) payoutWeights.set(p, payout(p));
  const rakeDed = allocateProportional(rake, payoutWeights);
  const jpDed = allocateProportional(jackpotTotal, profitWeights);

  const losers: PartyDelta[] = [];
  const winners: PartyDelta[] = [];
  for (const p of players) {
    const net = payout(p) - contrib(p) - (rakeDed.get(p) ?? 0) - (jpDed.get(p) ?? 0);
    if (net > 0) winners.push({ playerId: p, amount: net });
    else if (net < 0) losers.push({ playerId: p, amount: -net });
  }

  return { losers, winners, rake, jackpotTotal, jackpot: splitJackpot(jackpotTotal) };
}

export interface NetSettlementConfig {
  /** Platform's cut on winnings, in basis points. */
  rakeBps: number;
  /** Jackpot injection on winnings, in basis points (default 50 = 0.5%). */
  jackpotBps?: number;
}

/**
 * Settle a banker-style game from each party's NET result (banker + bettors, summing to zero — the
 * platform is never a party). The platform takes only a rake on winnings; a jackpot is injected
 * from winnings too. Deductions come off the winners proportionally. Result is conserved:
 * Σ(losers) = Σ(winners) + rake + jackpot.
 */
export function settleNet(
  grossNets: Map<string, number>,
  cfg: NetSettlementConfig,
): TableSettlement {
  const totalWin = [...grossNets.values()].filter((n) => n > 0).reduce((a, b) => a + b, 0);
  const rake = Math.floor((totalWin * cfg.rakeBps) / 10000);
  const jackpotTotal = Math.floor((totalWin * (cfg.jackpotBps ?? 50)) / 10000);

  const winWeights = new Map<string, number>();
  for (const [p, n] of grossNets) if (n > 0) winWeights.set(p, n);
  const rakeDed = allocateProportional(rake, winWeights);
  const jpDed = allocateProportional(jackpotTotal, winWeights);

  const losers: PartyDelta[] = [];
  const winners: PartyDelta[] = [];
  for (const [p, gross] of grossNets) {
    const net = gross - (rakeDed.get(p) ?? 0) - (jpDed.get(p) ?? 0);
    if (net > 0) winners.push({ playerId: p, amount: net });
    else if (net < 0) losers.push({ playerId: p, amount: -net });
  }
  return { losers, winners, rake, jackpotTotal, jackpot: splitJackpot(jackpotTotal) };
}

export interface TableSettlementContext {
  roundId: string;
  tableType: 'PLATFORM' | 'LEAGUE';
  /**
   * Which game this hand was — `texas`, `niu-niu`, and so on.
   *
   * Drives VIP volume recording, which is skipped entirely when it is absent.
   * It was absent everywhere until 14 Sep 2026, so no volume had ever been
   * recorded; see the note in `toTableSettlementRequest`.
   */
  gameId?: string;
  leagueId?: string;
  /** Map a table player id to their Financial Core account id. */
  accountOf: (playerId: string) => string;
  jackpotAccounts: JackpotAccounts;
  /** Convert chip counts to FC decimal-string amounts (default: 1 chip = 1 unit). */
  chipToAmount?: (chips: number) => string;
}

/** Build the Financial Core request from a computed settlement. */
export function toTableSettlementRequest(
  s: TableSettlement,
  ctx: TableSettlementContext,
): TableSettlementRequest {
  const amt = ctx.chipToAmount ?? ((c: number): string => String(c));
  return {
    roundId: ctx.roundId,
    tableType: ctx.tableType,
    /*
     * THE GAME THE HAND WAS PLAYED AT.
     *
     * `TableSettlementRequest.gameId` has always been optional and NOTHING EVER
     * SET IT, so the guard in the FC client —
     *
     *   if (req.gameId !== undefined) await this.recordHandVolume(...)
     *
     * — was false on every hand ever settled, by every game. VIP volume was
     * therefore never recorded for anybody, which is why the Data page's Play
     * Distribution donut read "No rounds played yet" over a player with 61
     * hands. Two cards disagreeing about the same player, because one of them
     * was fed by a call that never happened.
     *
     * It is threaded through here rather than set in each room: every game
     * builds its request with this function, so doing it once fixes the count
     * for all of them and leaves no game to be forgotten later.
     *
     * Still OPTIONAL. A caller that genuinely has no game id (a test, a
     * one-off) omits it and simply records no volume, exactly as before —
     * this widens what works, it does not add a way to fail.
     */
    ...(ctx.gameId ? { gameId: ctx.gameId } : {}),
    ...(ctx.leagueId ? { leagueId: ctx.leagueId } : {}),
    losers: s.losers.map((l) => ({ playerAccountId: ctx.accountOf(l.playerId), amount: amt(l.amount) })),
    winners: s.winners.map((w) => ({ playerAccountId: ctx.accountOf(w.playerId), amount: amt(w.amount) })),
    rake: amt(s.rake),
    jackpot: {
      mini: amt(s.jackpot.mini),
      minor: amt(s.jackpot.minor),
      major: amt(s.jackpot.major),
      grand: amt(s.jackpot.grand),
    },
    jackpotAccounts: ctx.jackpotAccounts,
  };
}
