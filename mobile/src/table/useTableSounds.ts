import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { play, releaseSounds, setSoundEnabled } from '../sound';
import type { TableSnapshot } from '../lib/liveTable';

/**
 * Turn a table's snapshots into sound. The native twin of the effects in
 * `frontend/src/pages/Table.tsx`, kept in one hook here because TableScreen is
 * already long and none of this is about layout.
 *
 * Everything is driven off what the SERVER says happened — each seat's
 * `lastAction`, the hand number — rather than off what this client sent. So a
 * stranger's raise sounds exactly like your own, which is the point: the table
 * should sound like a table, not like your own keyboard.
 */
export function useTableSounds(snapshot: TableSnapshot | null): void {
  /**
   * The account's sound preference, the same row the Settings toggle writes.
   * Sound stays OFF until it arrives — a muted player's first hand must not
   * be noisy while their settings load.
   */
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ sound: boolean }>('/me/settings'),
    staleTime: 60_000,
  });
  const on = settings.isSuccess ? settings.data.sound : false;

  useEffect(() => {
    setSoundEnabled(on);
  }, [on]);

  // Native audio players hold real handles; the table is where they are made,
  // so the table is where they are given back.
  useEffect(() => () => releaseSounds(), []);

  /**
   * Your turn — once per turn.
   *
   * Latched, because the snapshot repeats while you sit there thinking and an
   * un-latched cue would nag every push.
   */
  const yourTurn = Boolean(
    snapshot?.seats.some((s) => s.isYou && s.index === snapshot.toActSeat) &&
      snapshot?.phase === 'IN_HAND',
  );
  const announcedTurn = useRef(false);
  useEffect(() => {
    if (!yourTurn) {
      announcedTurn.current = false;
      return;
    }
    if (announcedTurn.current) return;
    announcedTurn.current = true;
    play('turn');
  }, [yourTurn]);

  /**
   * A new hand.
   *
   * Keyed on the hand NUMBER, not the phase: a reconnect can repeat a phase,
   * and re-dealing the same hand audibly is how a table starts sounding
   * broken. The first snapshot is swallowed so sitting down mid-hand does not
   * announce a deal that already happened.
   */
  const handNumber = snapshot?.handNumber ?? 0;
  const lastDealt = useRef<number | null>(null);
  useEffect(() => {
    if (handNumber <= 0) return;
    if (lastDealt.current === null) {
      lastDealt.current = handNumber;
      return;
    }
    if (handNumber === lastDealt.current) return;
    lastDealt.current = handNumber;
    play('deal');
  }, [handNumber]);

  /**
   * Every seat's action as it lands.
   *
   * The stamp carries the hand and the amount, so a call of 20 and a later
   * call of 60 are two events while the same snapshot arriving twice is one.
   */
  const voiced = useRef(new Map<number, string>());
  useEffect(() => {
    if (!snapshot) return;
    for (const seat of snapshot.seats) {
      const action = seat.lastAction;
      if (!action || typeof action === 'string') continue;
      const stamp = `${snapshot.handNumber}:${action.kind}:${action.amount ?? ''}`;
      if (voiced.current.get(seat.index) === stamp) continue;
      voiced.current.set(seat.index, stamp);
      if (action.kind === 'fold') play('fold');
      else if (action.kind === 'check') play('check');
      else play('chip'); // call, raise, all-in — all of them move chips
    }
  }, [snapshot]);

  /**
   * The pot arriving. Once per hand, and only when you are among the winners —
   * the reward cue is reserved for an actual reward.
   */
  const celebrated = useRef<number | null>(null);
  useEffect(() => {
    if (!snapshot || snapshot.phase !== 'SHOWDOWN') return;
    if (celebrated.current === snapshot.handNumber) return;
    const you = snapshot.seats.find((s) => s.isYou);
    if (!you || !snapshot.winners.includes(you.index)) return;
    celebrated.current = snapshot.handNumber;
    play('win');
  }, [snapshot]);
}
