import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SeatStrip } from './SeatStrip';

export interface LotteryFeltProps {
  snapshot?: any;
  onCommand?: (cmd: any) => void;
}

export function LotteryFelt({ snapshot, onCommand }: LotteryFeltProps) {
  const [selectedNum, setSelectedNum] = useState<number>(0);
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
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-purple-950 p-4 text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#581c87_0%,#2e1065_100%)] opacity-90" />

      <div className="relative z-10 flex items-center justify-between border-b border-purple-800/40 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-wider text-amber-400">LOTTERY DRAW</span>
          <span className="rounded bg-purple-800/60 px-2 py-0.5 text-xs text-purple-200">{phase}</span>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center p-4">
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 10 }, (_, n) => (
            <button
              key={n}
              onClick={() => setSelectedNum(n)}
              className={`flex h-14 w-14 items-center justify-center rounded-2xl border text-xl font-bold transition ${
                selectedNum === n ? 'border-amber-400 bg-amber-500 text-black ring-2 ring-amber-400' : 'border-purple-700 bg-purple-900/60 text-purple-200'
              }`}
            >
              #{n}
            </button>
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
                onClick={() => setBetAmount(amt)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  betAmount === amt ? 'bg-amber-400 text-black' : 'bg-purple-900 text-purple-200'
                }`}
              >
                ₮{amt}
              </button>
            ))}
            <Button
              variant="primary"
              size="sm"
              onClick={() => onCommand?.({ kind: 'act', action: { type: String(selectedNum), amount: betAmount } })}
            >
              Buy Ticket #{selectedNum} (₮{betAmount})
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="sm" onClick={() => sitDown()}>
            Sit to Play Lottery
          </Button>
        )}
      </div>
    </div>
  );
}
