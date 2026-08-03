/**
 * A single-table No-Limit Hold'em hand driver for the play-money demo.
 *
 * Deliberately client-side and single-main-pot (no side pots): it exists to make the
 * table interactive and show the full hand lifecycle. Real-money hands are settled by
 * the authoritative server engine, which already handles side pots and provably-fair
 * shuffling. Everything here is pure — the hook layers timing/animation on top.
 */
import { fullDeck, type Card } from './cards';
import { evaluate, compareScore } from './handEval';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface EngineSeat {
  id: number;
  name: string;
  stack: number;
  bet: number; // committed this street
  cards: Card[]; // 2 hole cards (empty if sitting out)
  folded: boolean;
  allIn: boolean;
  hasActed: boolean; // acted since the last raise on this street
  isHero: boolean;
  busted: boolean;
}

export interface EngineState {
  handId: number;
  deck: Card[];
  board: Card[];
  seats: EngineSeat[];
  dealer: number;
  street: Street;
  pot: number;
  currentBet: number; // highest bet this street
  minRaise: number; // minimum raise increment
  toAct: number; // seat index to act (-1 when none)
  sb: number;
  bb: number;
  phase: 'betting' | 'handover';
  message: string;
  winners: number[];
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }; // total amount to raise the bet to

let seq = 1;

function shuffle(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const activeSeats = (s: EngineState) => s.seats.filter((p) => !p.folded && !p.busted);
const canActSeats = (s: EngineState) => s.seats.filter((p) => !p.folded && !p.busted && !p.allIn);

/** Next seat index (clockwise) matching a predicate, or -1. */
function nextIndex(s: EngineState, from: number, pred: (p: EngineSeat) => boolean): number {
  const n = s.seats.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (pred(s.seats[i])) return i;
  }
  return -1;
}

/** Start a fresh hand, rotating the dealer and dealing hole cards + posting blinds. */
export function startHand(prev: EngineState | null, seed?: EngineSeat[]): EngineState {
  const base = prev?.seats ?? seed!;
  const seats: EngineSeat[] = base.map((p) => ({
    ...p,
    bet: 0,
    cards: [],
    folded: false,
    allIn: false,
    hasActed: false,
    busted: p.stack <= 0,
  }));

  const dealer = prev
    ? nextIndexRaw(seats, prev.dealer, (p) => !p.busted)
    : nextIndexRaw(seats, seats.length - 1, (p) => !p.busted);

  const deck = shuffle(fullDeck());
  for (const p of seats) if (!p.busted) p.cards = [deck.pop()!, deck.pop()!];

  const sb = 10;
  const bb = 20;
  const state: EngineState = {
    handId: seq++,
    deck,
    board: [],
    seats,
    dealer,
    street: 'preflop',
    pot: 0,
    currentBet: bb,
    minRaise: bb,
    toAct: -1,
    sb,
    bb,
    phase: 'betting',
    message: '',
    winners: [],
  };

  const sbIndex = nextIndexRaw(seats, dealer, (p) => !p.busted);
  const bbIndex = nextIndexRaw(seats, sbIndex, (p) => !p.busted);
  postBlind(seats[sbIndex], sb);
  postBlind(seats[bbIndex], bb);

  state.toAct = nextIndexRaw(seats, bbIndex, (p) => !p.busted && !p.allIn);
  return state;
}

function nextIndexRaw(seats: EngineSeat[], from: number, pred: (p: EngineSeat) => boolean): number {
  const n = seats.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (pred(seats[i])) return i;
  }
  return from;
}

function postBlind(p: EngineSeat, amount: number) {
  const put = Math.min(amount, p.stack);
  p.stack -= put;
  p.bet = put;
  if (p.stack === 0) p.allIn = true;
}

/** What the hero (or any seat) may legally do right now. */
export function legalActions(s: EngineState, i: number) {
  const p = s.seats[i];
  const toCall = Math.max(0, s.currentBet - p.bet);
  const canCheck = toCall === 0;
  const minRaiseTo = s.currentBet + s.minRaise;
  const maxRaiseTo = p.bet + p.stack; // all-in ceiling
  return {
    toCall: Math.min(toCall, p.stack),
    canCheck,
    canCall: toCall > 0,
    minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
    maxRaiseTo,
    canRaise: p.stack > toCall,
  };
}

/** Apply an action for the seat currently to act; returns the next state (immutable-ish clone). */
export function applyAction(prev: EngineState, action: Action): EngineState {
  const s = clone(prev);
  const i = s.toAct;
  if (i < 0) return s;
  const p = s.seats[i];
  const toCall = Math.max(0, s.currentBet - p.bet);

  switch (action.type) {
    case 'fold':
      p.folded = true;
      p.hasActed = true;
      break;
    case 'check':
      p.hasActed = true;
      break;
    case 'call': {
      const put = Math.min(toCall, p.stack);
      p.stack -= put;
      p.bet += put;
      if (p.stack === 0) p.allIn = true;
      p.hasActed = true;
      break;
    }
    case 'raise': {
      const target = Math.min(action.to, p.bet + p.stack);
      const put = target - p.bet;
      p.stack -= put;
      p.bet = target;
      if (p.stack === 0) p.allIn = true;
      const raiseSize = target - s.currentBet;
      if (raiseSize >= s.minRaise) s.minRaise = raiseSize;
      s.currentBet = target;
      // a genuine raise reopens the action for everyone else
      for (const other of s.seats) if (other.id !== p.id && !other.folded && !other.allIn) other.hasActed = false;
      p.hasActed = true;
      break;
    }
  }

  return advance(s);
}

/** Decide whether the street/hand is over and move things forward. */
function advance(s: EngineState): EngineState {
  // Everyone folded but one → award immediately.
  if (activeSeats(s).length === 1) {
    collectBets(s);
    const winner = activeSeats(s)[0];
    s.winners = [winner.id];
    winner.stack += s.pot;
    s.message = `${winner.name} wins ₮${s.pot.toLocaleString()}`;
    s.pot = 0;
    s.phase = 'handover';
    s.toAct = -1;
    return s;
  }

  // Betting round complete?
  const needAction = canActSeats(s).filter((p) => !p.hasActed || p.bet < s.currentBet);
  if (needAction.length === 0) {
    return endStreet(s);
  }

  // Otherwise pass action to the next eligible seat.
  s.toAct = nextIndex(s, s.toAct, (p) => !p.folded && !p.busted && !p.allIn && (!p.hasActed || p.bet < s.currentBet));
  return s;
}

function collectBets(s: EngineState) {
  for (const p of s.seats) {
    s.pot += p.bet;
    p.bet = 0;
  }
}

function endStreet(s: EngineState): EngineState {
  collectBets(s);
  for (const p of s.seats) p.hasActed = false;
  s.currentBet = 0;
  s.minRaise = s.bb;

  // If at most one seat can still act, run the remaining board to showdown.
  const runOut = canActSeats(s).length <= 1;

  const deal = (n: number) => {
    for (let k = 0; k < n; k++) s.board.push(s.deck.pop()!);
  };

  const nextStreet: Record<Street, Street> = {
    preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown', showdown: 'showdown',
  };

  do {
    s.street = nextStreet[s.street];
    if (s.street === 'flop') deal(3);
    else if (s.street === 'turn' || s.street === 'river') deal(1);
  } while (runOut && s.street !== 'showdown');

  if (s.street === 'showdown') return showdown(s);

  s.toAct = nextIndex(s, s.dealer, (p) => !p.folded && !p.busted && !p.allIn);
  return s;
}

function showdown(s: EngineState): EngineState {
  const contenders = activeSeats(s);
  let best: number[] | null = null;
  const scored = contenders.map((p) => {
    const hs = evaluate([...p.cards, ...s.board]);
    if (!best || compareScore(hs.score, best) > 0) best = hs.score;
    return { p, hs };
  });
  const winners = scored.filter((x) => compareScore(x.hs.score, best!) === 0);
  const pot = s.pot;
  const share = Math.floor(pot / winners.length);
  let remainder = pot - share * winners.length; // odd chips go to the first winner(s)
  for (const w of winners) {
    w.p.stack += share;
    if (remainder > 0) {
      w.p.stack += 1;
      remainder--;
    }
  }
  s.winners = winners.map((w) => w.p.id);
  const handName = winners[0].hs.name;
  s.message =
    winners.length === 1
      ? `${winners[0].p.name} wins ₮${pot.toLocaleString()} with ${handName}`
      : `Split pot — ${handName}`;
  s.pot = 0;
  s.phase = 'handover';
  s.toAct = -1;
  return s;
}

function clone(s: EngineState): EngineState {
  return { ...s, deck: [...s.deck], board: [...s.board], seats: s.seats.map((p) => ({ ...p, cards: [...p.cards] })), winners: [...s.winners] };
}
