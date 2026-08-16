import type { LiveSeat, TableSnapshot } from '@/lib/liveTable';

/**
 * THROWAWAY DEMO — delete `src/demo/` and its one route to remove it.
 *
 * A walkthrough of how each game plays, for showing people. Every step here is a hand-written
 * `TableSnapshot`: the exact shape the server sends over the socket, fed to the exact screens the
 * app renders. So what you see is the real UI and the real wire format — but the outcomes are
 * scripted, nobody is dealt anything, and no money exists. Nothing in `src/demo/` is imported by
 * the app itself.
 */

export interface DemoStep {
  /** What is happening, in one line, shown under the felt. */
  caption: string;
  snapshot: TableSnapshot;
  /** How long to hold this step when it plays itself, in ms. */
  holdMs?: number;
}

export interface DemoScript {
  /** The table id whose screen this drives — picks the felt. */
  tableId: string;
  title: string;
  /** The one thing this game is, in a sentence a stranger understands. */
  premise: string;
  steps: DemoStep[];
}

const YOU = 'you';

interface SeatSpec {
  index: number;
  name: string;
  stack: number;
  bet?: number;
  cards?: (string | null)[];
  status?: LiveSeat['status'];
  isYou?: boolean;
  isDealer?: boolean;
  isWinner?: boolean;
  lastAction?: string;
}

export function seat(spec: SeatSpec): LiveSeat {
  return {
    index: spec.index,
    playerId: spec.isYou ? YOU : `p${spec.index}`,
    name: spec.name,
    stack: spec.stack,
    bet: spec.bet ?? 0,
    status: spec.status ?? 'waiting',
    inHand: true,
    connected: true,
    isDealer: spec.isDealer ?? false,
    isWinner: spec.isWinner ?? false,
    isYou: spec.isYou ?? false,
    cards: spec.cards ?? [],
    ...(spec.lastAction ? { lastAction: spec.lastAction } : {}),
  };
}

interface SnapSpec {
  tableId: string;
  name: string;
  variant: string;
  seats: LiveSeat[];
  phase?: TableSnapshot['phase'];
  stage?: string;
  board?: string[];
  pot?: number;
  message?: string;
  toActSeat?: number | null;
  maxSeats?: number;
  smallBlind?: number;
  bigBlind?: number;
  street?: TableSnapshot['street'];
  legal?: TableSnapshot['legal'];
}

/** A snapshot with every field the screens read, so a step only states what it changes. */
export function snap(spec: SnapSpec): TableSnapshot {
  const you = spec.seats.find((s) => s.isYou);
  return {
    tableId: spec.tableId,
    name: spec.name,
    variant: spec.variant,
    smallBlind: spec.smallBlind ?? 10,
    bigBlind: spec.bigBlind ?? 20,
    minBuyIn: 1_000,
    maxBuyIn: 50_000,
    // Big enough to hold the highest seat NUMBER, not just the count: the screens build the ring
    // from `maxSeats` and place each player at their index, so a table sized by headcount quietly
    // drops anyone sitting past the end of it.
    maxSeats: Math.max(spec.maxSeats ?? 0, ...spec.seats.map((s) => s.index + 1)),
    phase: spec.phase ?? 'IN_HAND',
    handId: '#1',
    handNumber: 1,
    street: spec.street ?? null,
    ...(spec.stage ? { stage: spec.stage } : {}),
    pot: spec.pot ?? 0,
    board: spec.board ?? [],
    seats: spec.seats,
    insurance: null,
    jackpot: null,
    yourSeat: you ? you.index : null,
    you: you ? { playerId: YOU, name: you.name, available: 8_000 } : null,
    toActSeat: spec.toActSeat === undefined ? null : spec.toActSeat,
    actionDeadline: null,
    legal: spec.legal ?? null,
    winners: spec.seats.filter((s) => s.isWinner).map((s) => s.index),
    ...(spec.message ? { message: spec.message } : {}),
    serverTime: 0,
  };
}
