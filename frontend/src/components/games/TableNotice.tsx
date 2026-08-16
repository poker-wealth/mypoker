import type { TableSnapshot } from '@/lib/liveTable';

/**
 * Why the table is not taking a bet right now.
 *
 * Every one of these games refuses to deal below some number of seats. Until the rooms started
 * saying so, a felt showed its chip buttons anyway: you sat down at San Zhang alone, pressed Place
 * Bet, and got "betting is closed" — accurate, and no help at all. The room now puts the reason in
 * `snapshot.message` while it waits, and a felt shows this instead of controls that cannot work.
 */
export function TableNotice({ snapshot }: { snapshot?: TableSnapshot | null }) {
  const phase = snapshot?.phase ?? 'WAITING';
  const text =
    snapshot?.message ??
    (phase === 'SHOWDOWN' ? 'Settling the round…' : 'Waiting for the next round…');

  return (
    <span className="rounded-full bg-black/45 px-4 py-1.5 text-center text-xs text-white/80">
      {text}
    </span>
  );
}
