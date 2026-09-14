import type { ActionType, Street } from '../games/texas/betting';

/**
 * WHAT HAPPENED IN A HAND — the record the whole Data page is waiting on.
 *
 * Every figure the reference screen shows and this product cannot currently
 * produce — VPIP, PFR, 3-Bet, 4-Bet, WTSD, W$SD, Aggression, BB/100, profit by
 * position, profit by starting hand — is derived from inside a hand: who put
 * money in before the flop, who raised, who re-raised, who reached showdown.
 *
 * The ledger records a round's NET MOVEMENT and its timestamp. That is enough
 * for profit, hands played and win rate, and enough for nothing else. So this
 * is a new record, not a new query over an old one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE IT LIVES, AND WHY IT IS NOT IN financial-core.
 *
 * Iron rule 4, facts vs rules: financial-core holds money and no opinion;
 * game-server holds the games. A hand history is a record of PLAY — cards,
 * positions, betting actions — none of which financial-core has any business
 * knowing. The money side of the same hand is already in the ledger, and the
 * two are joined by `roundId`, which settlement already mints.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS PURE. No database, no clock, no engine. It defines the record
 * and derives the per-seat statistics from an action log, so both can be tested
 * without a table, a socket or a Mongo instance — and so the definitions of
 * VPIP and the rest live in ONE readable place rather than being re-implemented
 * by whichever screen asks next.
 */

/** One action, as it was actually taken. */
export interface RecordedAction {
  playerId: string;
  street: Street;
  type: ActionType;
  /** Chips this action committed. Zero for a check or a fold. */
  amount: number;
}

/** Where a seat sat, relative to the button. */
export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'MP' | 'CO';

export interface SeatHandRecord {
  playerId: string;
  seatIndex: number;
  position: Position;
  /** The cards they were dealt. Recorded for hand-type analysis. */
  holeCards: readonly string[];
  /** Total chips they put in across the hand, blinds included. */
  invested: number;
  /** What they finished with, net of everything. Signed. */
  net: number;
  /** They were still in when the hand reached showdown. */
  sawShowdown: boolean;
  /** They won chips at that showdown. */
  wonAtShowdown: boolean;
}

export interface HandRecord {
  /** The same id settlement used, so money and play join on one key. */
  roundId: string;
  tableId: string;
  gameId: string;
  handNumber: number;
  playedAt: Date;
  bigBlind: number;
  /** Board as it was revealed. Empty when everyone folded preflop. */
  community: readonly string[];
  seats: readonly SeatHandRecord[];
  actions: readonly RecordedAction[];
}

/**
 * POSITION, from the seat's distance after the button.
 *
 * Only the three that are the same at every table size are named absolutely —
 * the button, and the two blinds immediately after it. Everything else is a
 * band, because "UTG" at a six-handed table and "UTG" at a nine-handed one are
 * not the same seat, and pretending otherwise would put two different things in
 * one row of the Position card.
 *
 * Heads-up is deliberately excluded: there the button IS the small blind, and a
 * table of two has no middle position to speak of. The caller passes the real
 * seat count so this never guesses.
 */
export function positionOf(seatsFromButton: number, playerCount: number): Position {
  if (seatsFromButton === 0) return 'BTN';
  if (playerCount === 2) return seatsFromButton === 1 ? 'BB' : 'BTN';
  if (seatsFromButton === 1) return 'SB';
  if (seatsFromButton === 2) return 'BB';
  // The seat immediately before the button acts last before it — the cutoff.
  if (seatsFromButton === playerCount - 1) return 'CO';
  // The first to act after the blinds.
  if (seatsFromButton === 3) return 'UTG';
  return 'MP';
}

/** The six measures the radar plots, for one player over many hands. */
export interface PlayerHandStats {
  hands: number;
  /** Voluntarily put money in preflop, as a percentage of hands. */
  vpip: number | null;
  /** Raised preflop, as a percentage of hands. */
  pfr: number | null;
  /** Re-raised a raise preflop, as a percentage of hands. */
  threeBet: number | null;
  /** Reached showdown, as a percentage of hands. */
  wtsd: number | null;
  /** Won at showdown, as a percentage of showdowns reached. */
  wssd: number | null;
  /**
   * Aggression factor: (raises) / (calls), across every street.
   *
   * Null rather than Infinity when a player has never called — a player who
   * only ever raises has no ratio, and rendering ∞ or a made-up ceiling would
   * be inventing a figure.
   */
  aggression: number | null;
  /** Big blinds won per 100 hands. Null until there is a hand to divide by. */
  bb100: number | null;
}

/** A percentage to one decimal, or null when there is nothing to divide by. */
function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Derive one player's statistics from the hands they actually played.
 *
 * EVERY DEFINITION IS THE STANDARD ONE, and each is written out because they
 * are easy to get subtly wrong and impossible to spot once they are on a chart:
 *
 *   VPIP counts money put in BY CHOICE. Posting a blind is not a choice, so a
 *   big blind who checks to see a flop has not "played" the hand. This is why
 *   blind posts are never recorded as actions — see the recorder.
 *
 *   PFR counts hands where the player raised preflop at all, not the number of
 *   raises. Raising twice in one hand is still one hand raised.
 *
 *   3-BET is the third bet of the preflop round. The big blind is the first
 *   bet, the first raise is the second, so a player's raise is a 3-bet when
 *   exactly ONE raise has come before it in that hand. Counting "any re-raise"
 *   would fold 4-bets and 5-bets into the same number.
 *
 *   WTSD is over hands PLAYED, and W$SD is over showdowns REACHED. Dividing
 *   both by the same denominator is the classic error: it makes a tight player
 *   who wins every showdown look like they win a third of them.
 */
export function deriveStats(records: readonly HandRecord[], playerId: string): PlayerHandStats {
  let hands = 0;
  let vpip = 0;
  let pfr = 0;
  let threeBet = 0;
  let showdowns = 0;
  let wonShowdowns = 0;
  let raises = 0;
  let calls = 0;
  let netBb = 0;

  for (const record of records) {
    const seat = record.seats.find((s) => s.playerId === playerId);
    if (!seat) continue;
    hands += 1;

    if (seat.sawShowdown) {
      showdowns += 1;
      if (seat.wonAtShowdown) wonShowdowns += 1;
    }

    // Big blinds, not chips: a hand at 1/2 and a hand at 50/100 are not
    // comparable in chips, and BB/100 is the figure that makes them so.
    if (record.bigBlind > 0) netBb += seat.net / record.bigBlind;

    let voluntary = false;
    let raisedPreflop = false;
    let threeBetThisHand = false;
    // Raises seen so far in THIS hand's preflop round, by anyone.
    let preflopRaisesBefore = 0;

    for (const action of record.actions) {
      const mine = action.playerId === playerId;

      if (action.street === 'PREFLOP') {
        if (mine) {
          if (action.type === 'call' || action.type === 'raise') voluntary = true;
          if (action.type === 'raise') {
            raisedPreflop = true;
            if (preflopRaisesBefore === 1) threeBetThisHand = true;
          }
        }
        // Counted AFTER the check above, so a player's own raise is weighed
        // against what came before it, not including itself.
        if (action.type === 'raise') preflopRaisesBefore += 1;
      }

      if (mine) {
        if (action.type === 'raise') raises += 1;
        if (action.type === 'call') calls += 1;
      }
    }

    if (voluntary) vpip += 1;
    if (raisedPreflop) pfr += 1;
    if (threeBetThisHand) threeBet += 1;
  }

  return {
    hands,
    vpip: pct(vpip, hands),
    pfr: pct(pfr, hands),
    threeBet: pct(threeBet, hands),
    wtsd: pct(showdowns, hands),
    wssd: pct(wonShowdowns, showdowns),
    aggression: calls > 0 ? Math.round((raises / calls) * 10) / 10 : null,
    bb100: hands > 0 ? Math.round((netBb / hands) * 100 * 10) / 10 : null,
  };
}

/** Net won by position, in big blinds — the Position card. */
export function netByPosition(
  records: readonly HandRecord[],
  playerId: string,
): Record<Position, number | null> {
  const totals: Record<string, { bb: number; hands: number }> = {};

  for (const record of records) {
    const seat = record.seats.find((s) => s.playerId === playerId);
    if (!seat || record.bigBlind <= 0) continue;
    const bucket = (totals[seat.position] ??= { bb: 0, hands: 0 });
    bucket.bb += seat.net / record.bigBlind;
    bucket.hands += 1;
  }

  const out = {} as Record<Position, number | null>;
  for (const position of ['BTN', 'CO', 'MP', 'UTG', 'SB', 'BB'] as const) {
    const bucket = totals[position];
    // Null, not zero: a position never played has no result, and "0.0" on the
    // card would read as having broken even there.
    out[position] = bucket ? Math.round(bucket.bb * 10) / 10 : null;
  }
  return out;
}
