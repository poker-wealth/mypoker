import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { PlayingCard } from '@/components/poker/PlayingCard';
import { TableNotice } from './TableNotice';
import { SeatStrip } from './SeatStrip';
import type { TableCommand, TableSnapshot } from '@/lib/liveTable';

/**
 * BACCARAT — two hands, three spots.
 *
 * The whole game is Player vs Banker and which of three spots you backed, so the felt shows the two
 * hands side by side with their totals and marks the spot holding your chips. Cards used to arrive
 * as one flat array with a '|' between the hands, drawn as a card face reading "|"; the room now
 * sends them apart in `gameState`.
 */

/** Mirrors the `gameState` built in game-server/src/live/baccarat-room.ts. */
interface BaccaratRound {
  revealed: boolean;
  playerCards: string[];
  bankerCards: string[];
  playerTotal: number | null;
  bankerTotal: number | null;
  outcome: 'PLAYER' | 'BANKER' | 'TIE' | null;
  tiePayout: number;
}

type Spot = 'player' | 'banker' | 'tie';

export interface BaccaratFeltProps {
  snapshot?: TableSnapshot | null;
  onCommand?: (cmd: TableCommand) => void;
}

const CHIPS = [50, 100, 500, 1_000];

export function BaccaratFelt({ snapshot, onCommand }: BaccaratFeltProps) {
  const [spot, setSpot] = useState<Spot>('player');
  const [betAmount, setBetAmount] = useState(100);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const phase = snapshot?.phase ?? 'WAITING';
  const seats = snapshot?.seats ?? [];
  const you = seats.find((s) => s.isYou);
  const round = snapshot?.gameState as BaccaratRound | undefined;
  const isSeated = Boolean(you);
  const staked = you?.bet ?? 0;

  const secondsLeft = snapshot?.actionDeadline
    ? Math.max(0, Math.ceil((snapshot.actionDeadline - now) / 1_000))
    : null;

  const sitDown = (): void => {
    const free = seats.find((s) => !s.playerId);
    onCommand?.({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot?.minBuyIn ?? 1_000 });
  };

  const placeBet = (type: Spot): void => {
    setSpot(type);
    onCommand?.({ kind: 'act', action: { type, amount: betAmount } });
  };

  const spots: Array<{ id: Spot; label: string; pays: string; tone: string; won: boolean }> = [
    {
      id: 'player',
      label: 'PLAYER',
      pays: '1 : 1',
      tone: 'text-sky-300 border-sky-400',
      won: round?.outcome === 'PLAYER',
    },
    {
      id: 'tie',
      label: 'TIE',
      pays: `${round?.tiePayout ?? 8} : 1`,
      tone: 'text-emerald-300 border-emerald-400',
      won: round?.outcome === 'TIE',
    },
    {
      id: 'banker',
      label: 'BANKER',
      pays: '0.95 : 1',
      tone: 'text-rose-300 border-rose-400',
      won: round?.outcome === 'BANKER',
    },
  ];

  return (
    <div className="relative flex min-h-[32rem] w-full flex-col self-stretch overflow-hidden bg-slate-950 p-4 text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#1e1b4b_0%,#0f172a_75%)]" />

      <div className="relative z-10 flex items-center justify-between border-b border-indigo-800/40 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-wider text-amber-400">BACCARAT</span>
          <span className="rounded bg-indigo-800/60 px-2 py-0.5 text-xs text-indigo-200">
            {secondsLeft !== null && phase === 'IN_HAND' ? `${secondsLeft}s` : phase}
          </span>
        </div>
        <div className="text-xs text-slate-300">
          Pot <span className="font-bold text-amber-300">₮{snapshot?.pot ?? 0}</span>
        </div>
      </div>

      {/* The two hands */}
      <div className="relative z-10 flex flex-1 items-center justify-center gap-6 py-5">
        <Hand
          title="PLAYER"
          accent="text-sky-300"
          cards={round?.playerCards ?? []}
          total={round?.playerTotal ?? null}
          won={round?.outcome === 'PLAYER'}
        />
        <div className="text-center">
          <div className="text-xs font-black tracking-widest text-slate-500">VS</div>
          {round?.outcome && (
            <div className="mt-2 rounded-full bg-amber-400/20 px-3 py-1 text-xs font-black tracking-wider text-amber-300">
              {round.outcome} WINS
            </div>
          )}
        </div>
        <Hand
          title="BANKER"
          accent="text-rose-300"
          cards={round?.bankerCards ?? []}
          total={round?.bankerTotal ?? null}
          won={round?.outcome === 'BANKER'}
        />
      </div>

      {/* The three spots. Your chips show on the one you backed. */}
      <div className="relative z-10 grid grid-cols-3 gap-3">
        {spots.map((s) => {
          const yours = staked > 0 && spot === s.id;
          return (
            <button
              key={s.id}
              onClick={() => (isSeated && phase === 'IN_HAND' ? placeBet(s.id) : setSpot(s.id))}
              className={`relative flex flex-col items-center justify-center rounded-xl border-2 p-4 transition ${
                s.won
                  ? 'border-amber-400 bg-amber-400/15'
                  : yours
                    ? `${s.tone} bg-white/5`
                    : 'border-slate-700 bg-slate-900/50 hover:bg-slate-800/60'
              }`}
            >
              <span className={`text-lg font-black ${s.tone.split(' ')[0]}`}>{s.label}</span>
              <span className="text-xs text-slate-400">{s.pays}</span>
              {yours && (
                <span className="absolute -top-2 rounded-full bg-amber-400 px-2 text-[0.65rem] font-black text-black">
                  ₮{staked}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="relative z-10 px-2 pt-3">
        <SeatStrip seats={seats} />
      </div>

      {/* Controls */}
      <div className="relative z-10 flex flex-col items-center gap-2 pt-2">
        {isSeated && phase === 'IN_HAND' ? (
          <>
            <div className="flex items-center gap-2">
              {CHIPS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setBetAmount(amt)}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                    betAmount === amt ? 'bg-amber-400 text-black' : 'bg-slate-800 text-slate-200'
                  }`}
                >
                  ₮{amt}
                </button>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={() => placeBet(spot)}>
              {staked > 0 ? `Staked ₮${staked}` : `Back ${spot.toUpperCase()} for ₮${betAmount}`}
            </Button>
          </>
        ) : isSeated ? (
          <TableNotice snapshot={snapshot} />
        ) : (
          <Button variant="primary" size="sm" onClick={sitDown}>
            Sit to Play Baccarat
          </Button>
        )}
      </div>
    </div>
  );
}

/** One side of the table: its cards, and the total they make. */
function Hand({
  title,
  accent,
  cards,
  total,
  won,
}: {
  title: string;
  accent: string;
  cards: string[];
  total: number | null;
  won: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-2xl border px-4 py-3 ${
        won ? 'border-amber-400 bg-amber-400/10' : 'border-white/10 bg-black/30'
      }`}
    >
      <div className={`text-sm font-black tracking-widest ${accent}`}>{title}</div>
      <div className="flex gap-1">
        {cards.length > 0
          ? cards.map((c, i) => <PlayingCard key={i} card={c} size="md" index={i} />)
          : [0, 1].map((i) => <PlayingCard key={i} size="md" faceDown />)}
      </div>
      <div className="text-xl font-black tabular-nums text-white">{total ?? '—'}</div>
    </div>
  );
}
