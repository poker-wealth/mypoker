import { useState } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { SeatStrip } from './SeatStrip';

export interface SlotsFeltProps {
  snapshot?: any;
  onCommand?: (cmd: any) => void;
}

const SYMBOL_ICONS: Record<string, string> = {
  CHERRY: '🍒',
  BELL: '🔔',
  STAR: '⭐',
  SEVEN: '7️⃣',
};

export function SlotsFelt({ snapshot, onCommand }: SlotsFeltProps) {
  const [wager, setWager] = useState(100);

  const phase = snapshot?.phase ?? 'WAITING';
  const seats = snapshot?.seats ?? [];
  const youSeat = seats.find((s: any) => s.isYou);
  const isSeated = Boolean(youSeat);
  const board = snapshot?.board ?? ['CHERRY', 'BELL', 'STAR'];

  /** Take the first free chair, at the table's own minimum — seat 0 is usually already taken. */
  const sitDown = (): void => {
    const free = (snapshot?.seats ?? []).find((s: any) => !s.playerId);
    onCommand?.({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot?.minBuyIn ?? 1000 });
  };

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-indigo-950 p-4 text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#312e81_0%,#1e1b4b_100%)] opacity-90" />

      <div className="relative z-10 flex items-center justify-between border-b border-indigo-800/40 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-wider text-amber-400">CLASSIC SLOTS</span>
          <span className="rounded bg-indigo-800/60 px-2 py-0.5 text-xs text-indigo-200">{phase}</span>
        </div>
      </div>

      {/* 3 Reels Slot Machine View */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center p-4">
        <div className="flex gap-4 rounded-3xl border-4 border-amber-500 bg-slate-900 p-6 shadow-2xl">
          {board.map((sym: string, i: number) => (
            <motion.div
              key={i}
              animate={{ scale: [0.9, 1.05, 1] }}
              className="flex h-24 w-20 items-center justify-center rounded-2xl border-2 border-amber-400/60 bg-indigo-950 text-4xl shadow-inner"
            >
              {SYMBOL_ICONS[sym] ?? sym}
            </motion.div>
          ))}
        </div>
      </div>

      <div className="relative z-10 px-2 pb-1">
        <SeatStrip seats={seats} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3 pb-2">
        {isSeated ? (
          <div className="flex items-center gap-3">
            {[50, 100, 500, 1000].map((amt) => (
              <button
                key={amt}
                onClick={() => setWager(amt)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  wager === amt ? 'bg-amber-400 text-black' : 'bg-indigo-900 text-indigo-200'
                }`}
              >
                ${amt}
              </button>
            ))}
            <Button
              variant="primary"
              size="sm"
              onClick={() => onCommand?.({ kind: 'act', action: { type: 'spin', amount: wager } })}
            >
              SPIN (${wager})
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="sm" onClick={() => sitDown()}>
            Sit to Play Slots
          </Button>
        )}
      </div>
    </div>
  );
}
