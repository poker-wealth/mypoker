import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TableSocket, type SocketStatus } from '@/api/tableSocket';
import { TABLES_URL, TABLES_WS_URL } from '@/config';
import { useSession } from '@/store/session';
import { deviceClientSeed } from '@/lib/clientSeed';
import type { LiveSeat, TableCommand, TableSnapshot } from '@/lib/liveTable';
import type { Seat, SeatStatus, Street, TableState } from '@/lib/table';
import type { PokerAction } from '@/components/poker/ActionBar';

/**
 * The live table feed — the same shape `useDemoHand` returns, fed by the real server instead of a
 * browser engine. `PokerTable`, `PlayerSeat`, `ActionBar` and `PlayingCard` render it unchanged:
 * only the source of truth moved, from this tab to the game server.
 *
 * Identity is not this hook's business: it takes whatever token the session store already holds
 * and hands it to the socket. If nobody is signed in there is simply nothing to connect with.
 */

export interface LiveTable {
  /** The raw server snapshot — for anything the shared view-model doesn't carry. */
  snapshot: TableSnapshot | null;
  /** The table as the existing components want it, rotated so you sit at the bottom. */
  view: TableState;
  status: SocketStatus;
  error: string | null;
  /** Chips you can buy in with, from the table server. */
  available: number;
  signedIn: boolean;
  /** Sign-in is still in flight — show a wait, not a "sign in" prompt. */
  signingIn: boolean;
  heroToAct: boolean;
  /** True when you're watching rather than playing. */
  watching: boolean;
  heroAct: (action: PokerAction) => void;
  sit: (seat: number, buyIn: number) => void;
  stand: () => void;
  sitOut: () => void;
  sitIn: () => void;
  topUp: (amount: number) => void;
  challenge: (targetId: string) => void;
  answerChallenge: (passed: boolean, responseMs: number) => void;
  socket: TableSocket | null;
}

const EMPTY_VIEW: TableState = {
  handId: '—',
  street: 'preflop',
  pot: 0,
  board: [],
  seats: [],
  heroSeat: 0,
  toCall: 0,
  currentBet: 0,
  minRaise: 0,
};

export function useLiveTable(tableId: string): LiveTable {
  const token = useSession((s) => s.token);
  const player = useSession((s) => s.player);
  const sessionStatus = useSession((s) => s.status);
  const signIn = useSession((s) => s.signIn);

  // The table is a full-screen route outside AppShell, which is the only other thing that signs a
  // player in — so opening /table/:id directly (a link, a refresh, a Telegram deep link) would
  // otherwise land on a table with no identity and never connect. Same 'idle' guard as the shell:
  // it means "no attempt made yet", so signing out doesn't immediately sign you back in.
  useEffect(() => {
    if (sessionStatus === 'idle') void signIn();
  }, [sessionStatus, signIn]);

  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(0);
  const socketRef = useRef<TableSocket | null>(null);
  /** Latest snapshot, readable from callbacks without re-creating them on every push. */
  const latest = useRef<TableSnapshot | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) {
      setStatus('closed');
      return;
    }
    const socket = new TableSocket(TABLES_WS_URL, token, tableId, {
      onSnapshot: (next) => {
        const prev = latest.current;
        latest.current = next;
        setSnapshot(next);
        setError(null);
        // A hand that just reached showdown has settled — real money moved through the ledger, so
        // refresh the wallet (balance + activity) the moment the result is on screen. Fires once per
        // hand, on the transition in, not on every snapshot.
        if (prev?.phase !== 'SHOWDOWN' && next.phase === 'SHOWDOWN') {
          void queryClient.invalidateQueries({ queryKey: ['wallet'] });
        }
      },
      onStatus: setStatus,
      onError: setError,
      // A token the table won't accept is a dead token — the same conclusion the API client draws
      // from a 401. Drop it so the next sign-in issues a good one, instead of retrying forever.
      onUnauthorized: () => useSession.getState().signOut(),
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [tableId, token, queryClient]);

  // Your buy-in budget changes when you sit down or cash out, so re-read it on both.
  const seated = snapshot?.yourSeat ?? null;
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void fetch(`${TABLES_URL}/api/live/chips`, { headers: { authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ available: number }>) : null))
      .then((body) => {
        if (!cancelled && body) setAvailable(body.available);
      })
      .catch(() => {
        /* the table still works; only the buy-in ceiling is unknown */
      });
    return () => {
      cancelled = true;
    };
  }, [token, seated]);

  const send = useCallback((command: TableCommand): void => {
    socketRef.current?.send(command);
  }, []);

  const heroAct = useCallback(
    (action: PokerAction): void => {
      // Double-tapping Call as the hand ends shouldn't fire a doomed command at the server.
      const now = latest.current;
      if (!now || now.legal === null || now.toActSeat !== now.yourSeat) return;
      send({
        kind: 'act',
        action: action.type === 'raise' ? { type: 'raise', amount: action.to } : { type: action.type },
      });
    },
    [send],
  );

  const sit = useCallback(
    (seat: number, buyIn: number): void => {
      // Name and photo travel with the request because the gateway keeps no player rows — they
      // label the seat and nothing more.
      send({
        kind: 'sit',
        seat,
        buyIn,
        ...(player?.displayName ? { name: player.displayName.slice(0, 24) } : {}),
        ...(player?.photoUrl ? { avatarUrl: player.photoUrl } : {}),
      });
      // Register this device's own client seed the moment we're seated, so every deal from here uses
      // the player's entropy, not the server's. Stable per device; published back in the round data.
      send({ kind: 'set_client_seed', seed: deviceClientSeed() });
    },
    [send, player?.displayName, player?.photoUrl],
  );

  const view = useMemo(() => (snapshot ? toView(snapshot) : EMPTY_VIEW), [snapshot]);

  return {
    snapshot,
    view,
    status,
    error,
    available,
    signedIn: Boolean(token),
    signingIn: sessionStatus === 'idle' || sessionStatus === 'authenticating',
    heroToAct: snapshot?.legal != null && snapshot.toActSeat === snapshot.yourSeat,
    watching: snapshot?.yourSeat == null,
    heroAct,
    sit,
    stand: useCallback(() => send({ kind: 'stand' }), [send]),
    sitOut: useCallback(() => send({ kind: 'sitOut' }), [send]),
    sitIn: useCallback(() => send({ kind: 'sitIn' }), [send]),
    topUp: useCallback((amount: number) => send({ kind: 'buyIn', amount }), [send]),
    challenge: useCallback((targetId: string) => send({ kind: 'challenge', targetId }), [send]),
    answerChallenge: useCallback((passed: boolean, responseMs: number) => send({ kind: 'answer_challenge', passed, responseMs }), [send]),
    socket: socketRef.current,
  };
}

const STREETS: Record<string, Street> = {
  PREFLOP: 'preflop',
  FLOP: 'flop',
  TURN: 'turn',
  RIVER: 'river',
  SHOWDOWN: 'river',
};

/**
 * Server snapshot → the table view-model.
 *
 * Its one job is filling in the empty chairs: the server only sends occupied seats, while the table
 * draws every position. Seat numbers are preserved exactly, so a chair belongs to the same circle on
 * the artwork for everyone looking at it.
 */
export function toView(snapshot: TableSnapshot): TableState {
  const bySeat = new Map(snapshot.seats.map((seat) => [seat.index, seat]));

  // Seat index maps straight to its position on the table art: chair 4 is the same circle on every
  // screen, and the chair you tapped is the chair you keep. (No rotating the viewer to the bottom —
  // that made picking a seat feel like being moved to a different one.)
  const seats: Seat[] = Array.from({ length: snapshot.maxSeats }, (_, index) => {
    const live = bySeat.get(index);
    return live ? toSeat(live, snapshot) : emptySeat(index);
  });

  const currentBet = snapshot.seats.reduce((max, seat) => Math.max(max, seat.bet), 0);
  const minRaise = snapshot.legal?.minRaiseTo
    ? Math.max(snapshot.bigBlind, snapshot.legal.minRaiseTo - currentBet)
    : snapshot.bigBlind;

  return {
    handId: snapshot.handId ? `#${snapshot.handNumber}` : '—',
    street: STREETS[snapshot.street ?? 'PREFLOP'] ?? 'preflop',
    pot: snapshot.pot,
    board: snapshot.board,
    seats,
    heroSeat: snapshot.yourSeat ?? 0, // your actual chair — the array is indexed by seat number
    toCall: snapshot.legal?.callAmount ?? 0,
    currentBet,
    minRaise,
    ...(snapshot.message ? { message: snapshot.message } : {}),
    handOver: snapshot.phase === 'SHOWDOWN',
  };
}

function toSeat(live: LiveSeat, snapshot: TableSnapshot): Seat {
  const toAct = snapshot.toActSeat === live.index;
  let status: SeatStatus = 'active';
  if (live.status === 'folded') status = 'folded';
  else if (live.status === 'allin') status = 'allin';
  else if (toAct) status = 'toact';

  return {
    id: live.index,
    playerId: live.playerId,
    name: live.name,
    ...(live.avatarUrl ? { avatar: live.avatarUrl } : {}),
    stack: live.stack,
    bet: live.bet,
    cards: live.cards,
    status,
    isHero: live.isYou,
    isDealer: live.isDealer,
    isWinner: live.isWinner,
    ...(live.lastAction ? { lastAction: live.lastAction } : {}),
    connected: live.connected,
    sittingOut: live.status === 'sittingout',
    ...(toAct && snapshot.actionDeadline ? { deadline: snapshot.actionDeadline } : {}),
  };
}

function emptySeat(index: number): Seat {
  return { id: index, name: '', stack: 0, bet: 0, cards: [], status: 'empty' };
}
