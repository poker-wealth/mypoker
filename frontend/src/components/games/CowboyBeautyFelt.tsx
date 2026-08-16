import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TableNotice } from './TableNotice';
import { SeatStrip } from './SeatStrip';

export interface CowboyBeautyFeltProps {
  snapshot?: any;
  onCommand?: (cmd: any) => void;
}

export function CowboyBeautyFelt({ snapshot, onCommand }: CowboyBeautyFeltProps) {
  const [selectedSide, setSelectedSide] = useState<'COWBOY' | 'BEAUTY'>('COWBOY');
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
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-slate-950 p-4 text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#1e293b_0%,#0f172a_100%)] opacity-90" />

      <div className="relative z-10 flex items-center justify-between border-b border-slate-800/40 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-wider text-amber-400">COWBOY & BEAUTY</span>
          <span className="rounded bg-slate-800/60 px-2 py-0.5 text-xs text-slate-200">{phase}</span>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center gap-6 p-4">
        <button
          onClick={() => setSelectedSide('COWBOY')}
          className={`flex flex-col items-center justify-center rounded-2xl border p-8 transition ${
            selectedSide === 'COWBOY' ? 'border-amber-400 bg-amber-950/60 ring-2 ring-amber-400' : 'border-slate-800 bg-slate-900/40'
          }`}
        >
          <span className="text-3xl font-bold text-amber-400">🤠 COWBOY</span>
        </button>

        <span className="text-xl font-bold text-slate-500">VS</span>

        <button
          onClick={() => setSelectedSide('BEAUTY')}
          className={`flex flex-col items-center justify-center rounded-2xl border p-8 transition ${
            selectedSide === 'BEAUTY' ? 'border-pink-400 bg-pink-950/60 ring-2 ring-pink-400' : 'border-slate-800 bg-slate-900/40'
          }`}
        >
          <span className="text-3xl font-bold text-pink-400">💃 BEAUTY</span>
        </button>
      </div>

      <div className="relative z-10 px-2 pb-1">
        <SeatStrip seats={seats} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3 pb-2">
        {isSeated && phase === 'IN_HAND' ? (
          <div className="flex items-center gap-3">
            {[50, 100, 500, 1000].map((amt) => (
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
            <Button
              variant="primary"
              size="sm"
              onClick={() => onCommand?.({ kind: 'act', action: { type: selectedSide, amount: betAmount } })}
            >
              Bet on {selectedSide} (₮{betAmount})
            </Button>
          </div>
        ) : isSeated ? (
          <TableNotice snapshot={snapshot} />
        ) : (
          <Button variant="primary" size="sm" onClick={() => sitDown()}>
            Sit to Play Cowboy & Beauty
          </Button>
        )}
      </div>
    </div>
  );
}
