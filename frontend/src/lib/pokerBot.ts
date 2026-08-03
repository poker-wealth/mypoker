/**
 * Lightweight opponent AI for the demo table. Not meant to be tough — just to make
 * hands feel alive: it folds junk, calls reasonable spots, and occasionally raises
 * with strength. Purely heuristic; no bearing on real-money play.
 */
import { evaluate } from './handEval';
import { legalActions, type Action, type EngineSeat, type EngineState } from './pokerEngine';
import type { Card } from './cards';

const RANK_VALUE: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

/** Rough 0..1 strength of a seat's holding given the current board. */
function strength(cards: Card[], board: Card[]): number {
  if (board.length === 0) {
    // preflop: value pairs and big/suited/connected cards
    const [a, b] = cards.map((c) => RANK_VALUE[c[0]]);
    const pair = a === b ? 0.35 + (a / 14) * 0.25 : 0;
    const high = (a + b) / 28; // 0..1
    const suited = cards[0][1] === cards[1][1] ? 0.06 : 0;
    const connected = Math.abs(a - b) === 1 ? 0.05 : 0;
    return Math.min(1, pair + high * 0.55 + suited + connected);
  }
  // postflop: normalize made-hand category (0..8) with a little smoothing
  const cat = evaluate([...cards, ...board]).category;
  return Math.min(1, cat / 8 + 0.12);
}

export function decideAction(s: EngineState, seat: EngineSeat): Action {
  const i = s.seats.indexOf(seat);
  const la = legalActions(s, i);
  const str = strength(seat.cards, s.board);
  const r = Math.random();

  if (la.toCall === 0) {
    // free to check; bet sometimes when strong
    if (str > 0.62 && r < 0.5 && la.canRaise) {
      const to = Math.min(la.minRaiseTo + s.bb * 2, la.maxRaiseTo);
      return { type: 'raise', to };
    }
    return { type: 'check' };
  }

  const potOdds = la.toCall / (s.pot + s.seats.reduce((n, p) => n + p.bet, 0) + la.toCall);

  // premium: raise sometimes, otherwise call
  if (str > 0.78 && r < 0.4 && la.canRaise) {
    const to = Math.min(s.currentBet + s.bb * 3, la.maxRaiseTo);
    return { type: 'raise', to };
  }
  if (str > potOdds + 0.12) return { type: 'call' };
  if (la.toCall <= s.bb && r < 0.55) return { type: 'call' }; // cheap peel
  return { type: 'fold' };
}
