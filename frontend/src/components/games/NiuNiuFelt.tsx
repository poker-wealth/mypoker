import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export interface NiuNiuFeltProps {
  snapshot?: any;
  onCommand?: (cmd: any) => void;
}

export function NiuNiuFelt({ snapshot, onCommand }: NiuNiuFeltProps) {
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
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-rose-950 p-4 text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#4c0519_0%,#1c050c_100%)] opacity-90" />

      <div className="relative z-10 flex items-center justify-between border-b border-rose-800/40 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-wider text-amber-400">NIU NIU (BULL BULL)</span>
          <span className="rounded bg-rose-800/60 px-2 py-0.5 text-xs text-rose-200">{phase}</span>
        </div>
      </div>

      {/* Seats grid */}
      <div className="relative z-10 grid grid-cols-3 gap-3 p-4">
        {seats.map((seat: any, i: number) => (
          <div key={i} className="flex flex-col items-center rounded-xl border border-rose-700/40 bg-rose-900/30 p-3">
            <div className="text-sm font-bold text-amber-300">{seat.name || `Seat ${i + 1}`}</div>
            <div className="text-xs text-rose-300">{seat.isDealer ? '👑 BANKER' : 'BETTOR'}</div>
            <div className="mt-2 text-xs font-semibold text-white">Stack: ₮{seat.stack}</div>
          </div>
        ))}
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
                  betAmount === amt ? 'bg-amber-400 text-black' : 'bg-rose-900 text-rose-200'
                }`}
              >
                ₮{amt}
              </button>
            ))}
            <Button variant="secondary" size="sm" onClick={() => onCommand?.({ kind: 'act', action: { type: 'claim-banker' } })}>
              Claim Banker
            </Button>
            <Button variant="primary" size="sm" onClick={() => onCommand?.({ kind: 'act', action: { type: 'bet', amount: betAmount } })}>
              Place Bet (₮{betAmount})
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="sm" onClick={() => sitDown()}>
            Sit to Play Niu Niu
          </Button>
        )}
      </div>
    </div>
  );
}
