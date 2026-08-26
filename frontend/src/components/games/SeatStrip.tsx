import { Bot, User } from 'lucide-react';
import type { LiveSeat } from '@/lib/liveTable';

/**
 * Who else is at the table, and what they have riding on this round.
 *
 * Several felts drew only your own controls, so a practice table looked empty even with three
 * players in it — you could not see the opponents you were betting against, or that they were
 * house AI. A chair is labelled AI only when the server says `isBot`: at a table of real people,
 * nobody is.
 */
export function SeatStrip({ seats, accent = 'amber' }: { seats: LiveSeat[]; accent?: 'amber' | 'emerald' }) {
  const taken = seats.filter((s) => s.playerId);
  if (taken.length === 0) return null;

  const ring = accent === 'emerald' ? 'border-emerald-400' : 'border-amber-400';

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {taken.map((seat) => (
        <div
          key={seat.index}
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
            seat.isWinner ? `${ring} bg-white/10` : 'border-white/10 bg-black/30'
          }`}
        >
          <div className="grid size-7 place-items-center rounded-full bg-white/10">
            {seat.isBot ? <Bot className="size-4" /> : <User className="size-4" />}
          </div>
          <div className="leading-tight">
            <div className="font-semibold">
              {seat.name}
              {seat.isYou ? ' (you)' : seat.isBot ? ' · AI' : ''}
            </div>
            <div className="text-white/60 tabular-nums">
              ${seat.stack.toLocaleString()}
              {seat.bet > 0 ? ` · bet $${seat.bet.toLocaleString()}` : ''}
              {seat.lastAction ? ` · ${seat.lastAction}` : ''}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
