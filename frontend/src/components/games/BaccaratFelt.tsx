import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TableNotice } from './TableNotice';
import { SeatStrip } from './SeatStrip';

export interface BaccaratFeltProps {
  snapshot?: any;
  onCommand?: (cmd: any) => void;
}

export function BaccaratFelt({ snapshot, onCommand }: BaccaratFeltProps) {
  const [selectedBetType, setSelectedBetType] = useState<'player' | 'banker' | 'tie'>('player');
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

  const handlePlaceBet = (type: 'player' | 'banker' | 'tie') => {
    onCommand?.({ kind: 'act', action: { type, amount: betAmount } });
  };

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-slate-950 p-4 text-white select-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#1e1b4b_0%,#0f172a_100%)] opacity-90" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between border-b border-indigo-800/40 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-wider text-amber-400">BACCARAT</span>
          <span className="rounded bg-indigo-800/60 px-2 py-0.5 text-xs text-indigo-200">{phase}</span>
        </div>
        <div className="text-xs text-slate-300">
          Pot: <span className="font-bold text-amber-300">₮{snapshot?.pot ?? 0}</span>
        </div>
      </div>

      {/* Cards & Outcome Area */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 py-4">
        {snapshot?.board?.length > 0 && (
          <div className="flex flex-col items-center gap-2">
            <div className="text-sm font-bold text-amber-400">{snapshot.message}</div>
            <div className="flex gap-2">
              {snapshot.board.map((card: string, i: number) => (
                <div key={i} className="flex h-16 w-11 items-center justify-center rounded border border-slate-300 bg-white font-bold text-slate-900 shadow">
                  {card}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Betting Spots Grid */}
        <div className="grid w-full max-w-md grid-cols-3 gap-3">
          <button
            onClick={() => setSelectedBetType('player')}
            className={`flex flex-col items-center justify-center rounded-xl border p-4 transition ${
              selectedBetType === 'player' ? 'border-blue-400 bg-blue-950/60 ring-2 ring-blue-400' : 'border-slate-700 bg-slate-900/40'
            }`}
          >
            <span className="text-lg font-bold text-blue-400">PLAYER</span>
            <span className="text-xs text-slate-400">1:1</span>
          </button>

          <button
            onClick={() => setSelectedBetType('tie')}
            className={`flex flex-col items-center justify-center rounded-xl border p-4 transition ${
              selectedBetType === 'tie' ? 'border-emerald-400 bg-emerald-950/60 ring-2 ring-emerald-400' : 'border-slate-700 bg-slate-900/40'
            }`}
          >
            <span className="text-lg font-bold text-emerald-400">TIE</span>
            <span className="text-xs text-slate-400">8:1</span>
          </button>

          <button
            onClick={() => setSelectedBetType('banker')}
            className={`flex flex-col items-center justify-center rounded-xl border p-4 transition ${
              selectedBetType === 'banker' ? 'border-red-400 bg-red-950/60 ring-2 ring-red-400' : 'border-slate-700 bg-slate-900/40'
            }`}
          >
            <span className="text-lg font-bold text-red-400">BANKER</span>
            <span className="text-xs text-slate-400">0.95:1</span>
          </button>
        </div>
      </div>

      <div className="relative z-10 px-2 pb-1">
        <SeatStrip seats={seats} />
      </div>

      {/* Controls */}
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
            <Button variant="primary" size="sm" onClick={() => handlePlaceBet(selectedBetType)}>
              Place Bet (₮{betAmount})
            </Button>
          </div>
        ) : isSeated ? (
          <TableNotice snapshot={snapshot} />
        ) : (
          <Button variant="primary" size="sm" onClick={() => sitDown()}>
            Sit to Play Baccarat
          </Button>
        )}
      </div>
    </div>
  );
}
