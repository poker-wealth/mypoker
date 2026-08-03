import { useEffect, useState } from 'react';
import {
  startHand,
  applyAction,
  type Action,
  type EngineSeat,
  type EngineState,
} from '@/lib/pokerEngine';
import { decideAction } from '@/lib/pokerBot';
import type { Seat, SeatStatus, TableState } from '@/lib/table';

const NAMES = ['You', 'Mei', 'Kojiro', 'Anya', 'Bruno', 'Rin'];

function seedSeats(): EngineSeat[] {
  return NAMES.map((name, i) => ({
    id: i,
    name,
    stack: 2000,
    bet: 0,
    cards: [],
    folded: false,
    allIn: false,
    hasActed: false,
    isHero: i === 0,
    busted: false,
  }));
}

const BOT_DELAY = 850;
const NEXT_HAND_DELAY = 3200;

/** Owns the demo hand: advances bots on a timer and rolls into the next hand. */
export function useDemoHand() {
  const [state, setState] = useState<EngineState>(() => startHand(null, seedSeats()));

  useEffect(() => {
    // Hand finished → briefly show the result, then deal the next one.
    if (state.phase === 'handover') {
      const t = setTimeout(() => setState((s) => startHand(s)), NEXT_HAND_DELAY);
      return () => clearTimeout(t);
    }
    // A bot is to act → decide after a short "thinking" beat.
    const seat = state.seats[state.toAct];
    if (state.toAct >= 0 && seat && !seat.isHero) {
      const t = setTimeout(() => {
        setState((s) => {
          const cur = s.seats[s.toAct];
          if (s.toAct < 0 || !cur || cur.isHero) return s;
          return applyAction(s, decideAction(s, cur));
        });
      }, BOT_DELAY);
      return () => clearTimeout(t);
    }
  }, [state]);

  const heroAct = (a: Action) =>
    setState((s) => (s.toAct >= 0 && s.seats[s.toAct].isHero ? applyAction(s, a) : s));

  const heroToAct = state.toAct >= 0 && !!state.seats[state.toAct]?.isHero;

  return { view: toView(state), heroAct, heroToAct };
}

/** Map authoritative-ish engine state into the UI view model the table renders. */
function toView(s: EngineState): TableState {
  const showdown = s.phase === 'handover';
  const seats: Seat[] = s.seats.map((p, i) => {
    let status: SeatStatus = 'active';
    if (p.busted) status = 'empty';
    else if (p.folded) status = 'folded';
    else if (p.allIn) status = 'allin';
    else if (i === s.toAct) status = 'toact';

    // Hero always sees own cards; opponents revealed only at showdown (if not folded).
    const reveal = p.isHero || (showdown && !p.folded && s.winners.length > 0);
    const cards = p.cards.length
      ? reveal
        ? p.cards
        : [null, null]
      : [];

    return {
      id: p.id,
      name: p.name,
      stack: p.stack,
      bet: p.bet,
      cards,
      status,
      isHero: p.isHero,
      isDealer: i === s.dealer,
      isWinner: s.winners.includes(p.id),
    };
  });

  const hero = s.seats.find((p) => p.isHero)!;
  return {
    handId: `#${s.handId}`,
    street: s.street === 'showdown' ? 'river' : s.street,
    pot: s.pot,
    board: s.board,
    seats,
    heroSeat: s.seats.indexOf(hero),
    toCall: Math.max(0, s.currentBet - hero.bet),
    currentBet: s.currentBet,
    minRaise: s.minRaise,
    message: s.message,
    handOver: showdown,
  };
}
