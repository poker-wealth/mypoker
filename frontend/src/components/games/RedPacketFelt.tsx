import { useEffect, useState } from 'react';
import type { LiveSeat, TableCommand, TableSnapshot } from '@/lib/liveTable';

/**
 * RED PACKET MINE SWEEPING — a room, not a form.
 *
 * A wall of numbered packets hangs in the middle, the players line the two sides with what they
 * grabbed, and the banker sits at the foot of the table. Claim a packet with your stake; when the
 * clock runs out the mines are revealed and the ones who took them pay the ones who didn't.
 *
 * Every number here is the server's. The felt shows the picks (already public — the whole table
 * watches you claim), and only ever learns which packets were mined after the round reveals them.
 */

/** Mirrors the `gameState` built in game-server/src/live/red-packet-room.ts. */
interface RedPacketRound {
  size: number;
  mineCount: number;
  /** Present only once the round has revealed. */
  mines?: number[];
  seats: Array<{ index: number; cell?: number; net?: number }>;
}

export interface RedPacketFeltProps {
  snapshot?: TableSnapshot;
  onCommand?: (cmd: TableCommand) => void;
}

const CHIPS = [50, 100, 500, 1_000];

export function RedPacketFelt({ snapshot, onCommand }: RedPacketFeltProps) {
  const [betAmount, setBetAmount] = useState(100);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const phase = snapshot?.phase ?? 'WAITING';
  const seats = snapshot?.seats ?? [];
  const round = snapshot?.gameState as RedPacketRound | undefined;
  const you = seats.find((s) => s.isYou);
  const banker = seats.find((s) => s.playerId && s.isDealer);
  const players = seats.filter((s) => s.playerId && !s.isDealer);

  const size = round?.size ?? 25;
  const mines = round?.mines;
  const stateOf = (index: number) => round?.seats.find((s) => s.index === index);
  const yourCell = you ? stateOf(you.index)?.cell : undefined;
  const claimedBy = new Map<number, LiveSeat>();
  for (const s of players) {
    const cell = stateOf(s.index)?.cell;
    if (cell !== undefined) claimedBy.set(cell, s);
  }

  const secondsLeft = snapshot?.actionDeadline
    ? Math.max(0, Math.ceil((snapshot.actionDeadline - now) / 1_000))
    : null;

  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onCommand?.({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot?.minBuyIn ?? 1_000 });
  };

  const claim = (cell: number): void => {
    if (!you || phase !== 'IN_HAND' || yourCell !== undefined) return;
    onCommand?.({ kind: 'act', action: { type: String(cell), amount: betAmount } });
  };

  const half = Math.ceil(players.length / 2);

  return (
    <div className="relative flex min-h-[34rem] w-full flex-col self-stretch overflow-hidden bg-[#4a0d22] text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#7c1636_0%,#4a0d22_55%,#26030f_100%)]" />

      {/* The banner across the top: what is in the middle and how many mines are in it */}
      <div className="relative z-10 flex items-center justify-center gap-3 px-3 pt-3 text-xs font-bold">
        <span className="rounded-full border border-amber-400/40 bg-black/40 px-3 py-1 text-amber-200">
          POT <span className="text-white">₮{snapshot?.pot ?? 0}</span>
        </span>
        <span className="rounded-full border border-amber-400/40 bg-black/40 px-3 py-1 text-amber-200">
          PACKETS <span className="text-white">{size}</span>
        </span>
        <span className="rounded-full border border-amber-400/40 bg-black/40 px-3 py-1 text-amber-200">
          💣 MINES <span className="text-white">{round?.mineCount ?? '—'}</span>
        </span>
      </div>

      <div className="relative z-10 flex flex-1 items-stretch gap-2 px-2 py-4">
        <PlayerColumn
          title="SWEEPERS"
          players={players.slice(0, half)}
          stateOf={stateOf}
          align="left"
        />

        {/* The packets */}
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <div className="text-center">
            {secondsLeft !== null && phase === 'IN_HAND' ? (
              <div className="text-sm font-black tracking-widest text-amber-200">
                COUNTDOWN · {secondsLeft}
              </div>
            ) : (
              <div className="text-sm font-black tracking-widest text-amber-200/70">
                {phase === 'SHOWDOWN' ? 'REVEALED' : 'WAITING'}
              </div>
            )}
            {phase === 'WAITING' && snapshot?.message && (
              <div className="mt-1 text-[0.7rem] text-rose-200/80">{snapshot.message}</div>
            )}
          </div>

          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(size))}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: size }, (_, cell) => {
              const owner = claimedBy.get(cell);
              const mined = mines?.includes(cell);
              const yours = yourCell === cell;
              return (
                <button
                  key={cell}
                  onClick={() => claim(cell)}
                  disabled={!you || phase !== 'IN_HAND' || yourCell !== undefined}
                  title={owner ? `Claimed by ${owner.name}` : undefined}
                  className={`relative grid h-11 w-11 place-items-center rounded-lg border text-[0.7rem] font-black shadow transition ${
                    mined
                      ? 'border-rose-400 bg-rose-600 text-white'
                      : yours
                        ? 'border-amber-300 bg-amber-500 text-black'
                        : owner
                          ? 'border-amber-700/60 bg-rose-900/80 text-amber-300/70'
                          : 'border-rose-700/60 bg-gradient-to-b from-rose-700 to-rose-900 text-amber-200 hover:from-rose-600'
                  } disabled:cursor-default`}
                >
                  <span className="leading-none">{mined ? '💣' : '🧧'}</span>
                  <span className="text-[0.55rem] leading-none opacity-80">{cell}</span>
                  {owner && !mined && (
                    <span className="absolute -bottom-1 max-w-full truncate rounded bg-black/70 px-1 text-[0.5rem] font-bold text-amber-200">
                      {owner.name.slice(0, 6)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <PlayerColumn
          title="SWEEPERS"
          players={players.slice(half)}
          stateOf={stateOf}
          align="right"
        />
      </div>

      {/* The banker, and the way in */}
      <div className="relative z-10 flex items-center justify-between gap-3 px-3 pb-3">
        <div className="min-w-40 rounded-xl border border-amber-400/50 bg-black/45 px-3 py-1.5 text-center">
          <div className="text-[0.6rem] font-black tracking-widest text-amber-300">👑 BANKER</div>
          <div className="truncate text-xs font-bold text-white">{banker?.name ?? '—'}</div>
          {banker && <div className="text-[0.7rem] text-amber-200">₮{banker.stack}</div>}
        </div>

        {!you ? (
          <button
            onClick={sitDown}
            className="rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 px-8 py-2.5 text-sm font-black tracking-wider text-black uppercase shadow-lg active:scale-95"
          >
            Join Game
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {CHIPS.map((amt) => (
              <button
                key={amt}
                onClick={() => setBetAmount(amt)}
                disabled={yourCell !== undefined}
                className={`h-10 w-10 rounded-full border-2 text-[0.65rem] font-black transition ${
                  betAmount === amt
                    ? 'border-amber-300 bg-amber-500 text-black'
                    : 'border-rose-700 bg-rose-900 text-amber-200'
                } disabled:opacity-40`}
              >
                {amt}
              </button>
            ))}
            <div className="text-[0.7rem] text-rose-100">
              {yourCell !== undefined
                ? `You hold packet #${yourCell}`
                : phase === 'IN_HAND'
                  ? `Tap a packet to claim it for ₮${betAmount}`
                  : 'Waiting for the next round'}
              <div className="font-bold text-white">Balance ₮{you.stack}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerColumn({
  title,
  players,
  stateOf,
  align,
}: {
  title: string;
  players: LiveSeat[];
  stateOf: (index: number) => { cell?: number; net?: number } | undefined;
  align: 'left' | 'right';
}) {
  return (
    <div className="hidden w-36 shrink-0 flex-col gap-1.5 sm:flex">
      <div className="rounded-lg border border-amber-400/40 bg-black/40 py-1 text-center text-[0.6rem] font-black tracking-widest text-amber-300">
        {title}
      </div>
      {players.map((p) => {
        const info = stateOf(p.index);
        return (
          <div
            key={p.index}
            className={`flex items-center justify-between gap-1 rounded-lg border px-2 py-1 ${
              p.isYou ? 'border-amber-300 bg-amber-400/15' : 'border-amber-700/40 bg-black/35'
            } ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
          >
            <div className="min-w-0">
              <div className="truncate text-[0.7rem] font-bold text-amber-100">{p.name}</div>
              <div className="text-[0.65rem] text-amber-300/80">₮{p.stack}</div>
            </div>
            <div className="shrink-0 text-right">
              {info?.cell !== undefined && (
                <div className="text-[0.6rem] font-black text-white">#{info.cell}</div>
              )}
              {info?.net !== undefined && info.net !== 0 && (
                <div
                  className={`text-[0.65rem] font-black ${info.net > 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {info.net > 0 ? '+' : ''}
                  {info.net}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
