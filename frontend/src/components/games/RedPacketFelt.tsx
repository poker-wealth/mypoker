import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SeatStrip } from './SeatStrip';

export interface RedPacketFeltProps {
  snapshot?: any;
  onCommand?: (cmd: any) => void;
}

export function RedPacketFelt({ snapshot, onCommand }: RedPacketFeltProps) {
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState(100);

  const phase = snapshot?.phase ?? 'WAITING';
  const seats = snapshot?.seats ?? [];
  const youSeat = seats.find((s: any) => s.isYou);
  const isSeated = Boolean(youSeat);

  /** Take the first free chair, at the table's own minimum — seat 0 is usually already taken. */
  const sitDown = (): void => {
    const free = (snapshot?.seats ?? []).find((s: any) => !s.playerId);
    onCommand?.({ kind: 'sit', seat: free?.index ?? 0, buyIn: snapshot?.minBuyIn ?? 1000 });
  };

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-red-950 p-4 text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#7f1d1d_0%,#450a0a_100%)] opacity-90" />

      <div className="relative z-10 flex items-center justify-between border-b border-red-800/40 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-wider text-amber-400">RED PACKET MINESWEEPER</span>
          <span className="rounded bg-red-800/60 px-2 py-0.5 text-xs text-red-200">{phase}</span>
        </div>
      </div>

      {/* 5x5 Minesweeper Grid */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center p-4">
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 25 }, (_, cell) => (
            <button
              key={cell}
              onClick={() => setSelectedCell(cell)}
              className={`flex h-12 w-12 items-center justify-center rounded-xl border font-bold shadow transition ${
                selectedCell === cell ? 'border-amber-400 bg-amber-500 text-black ring-2 ring-amber-400' : 'border-red-700 bg-red-900/60 text-amber-300'
              }`}
            >
              🧧 {cell}
            </button>
          ))}
        </div>
      </div>

      <div className="relative z-10 px-2 pb-1">
        <SeatStrip seats={seats} />
      </div>

      {/* Controls */}
      <div className="relative z-10 flex flex-col items-center gap-3 pb-2">
        {isSeated ? (
          <div className="flex items-center gap-3">
            {[50, 100, 500, 1000].map((amt) => (
              <button
                key={amt}
                onClick={() => setBetAmount(amt)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  betAmount === amt ? 'bg-amber-400 text-black' : 'bg-red-900 text-red-200'
                }`}
              >
                ₮{amt}
              </button>
            ))}
            <Button
              variant="primary"
              size="sm"
              disabled={selectedCell === null}
              onClick={() => onCommand?.({ kind: 'act', action: { type: String(selectedCell), amount: betAmount } })}
            >
              Pick Cell {selectedCell !== null ? `#${selectedCell}` : ''} (₮{betAmount})
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="sm" onClick={() => sitDown()}>
            Sit to Play Red Packet
          </Button>
        )}
      </div>
    </div>
  );
}
