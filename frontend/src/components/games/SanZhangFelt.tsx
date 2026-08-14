import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TableNotice } from './TableNotice';

export interface SanZhangFeltProps {
  snapshot?: any;
  onCommand?: (cmd: any) => void;
}

export function SanZhangFelt({ snapshot, onCommand }: SanZhangFeltProps) {
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
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-amber-950 p-4 text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#451a03_0%,#1a0902_100%)] opacity-90" />

      <div className="relative z-10 flex items-center justify-between border-b border-amber-800/40 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-wider text-amber-400">SAN ZHANG (3 CARDS)</span>
          <span className="rounded bg-amber-800/60 px-2 py-0.5 text-xs text-amber-200">{phase}</span>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-3 gap-3 p-4">
        {seats.map((seat: any, i: number) => (
          <div key={i} className="flex flex-col items-center rounded-xl border border-amber-700/40 bg-amber-900/30 p-3">
            <div className="text-sm font-bold text-amber-300">{seat.name || `Seat ${i + 1}`}</div>
            <div className="text-xs text-amber-300">{seat.isDealer ? '👑 BANKER' : 'PLAYER'}</div>
            <div className="mt-2 text-xs font-semibold text-white">Stack: ₮{seat.stack}</div>
          </div>
        ))}
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3 pb-2">
        {isSeated && phase === 'IN_HAND' ? (
          <div className="flex items-center gap-3">
            {[50, 100, 500, 1000].map((amt) => (
              <button
                key={amt}
                onClick={() => setBetAmount(amt)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  betAmount === amt ? 'bg-amber-400 text-black' : 'bg-amber-900 text-amber-200'
                }`}
              >
                ₮{amt}
              </button>
            ))}
            <Button variant="primary" size="sm" onClick={() => onCommand?.({ kind: 'act', action: { type: 'bet', amount: betAmount } })}>
              Place Bet (₮{betAmount})
            </Button>
          </div>
        ) : isSeated ? (
          <TableNotice snapshot={snapshot} />
        ) : (
          <Button variant="primary" size="sm" onClick={() => sitDown()}>
            Sit to Play San Zhang
          </Button>
        )}
      </div>
    </div>
  );
}
