import { PlayerSeat } from './PlayerSeat';
import { PlayingCard } from './PlayingCard';
import type { TableState } from '@/lib/table';

/** Percentage positions around the oval for up to 6 seats; index 0 = hero (bottom center). */
const SEAT_POS = [
  { left: '50%', top: '96%' }, // hero
  { left: '8%', top: '72%' },
  { left: '8%', top: '24%' },
  { left: '50%', top: '2%' },
  { left: '92%', top: '24%' },
  { left: '92%', top: '72%' },
];

export function PokerTable({ state }: { state: TableState }) {
  return (
    <div className="relative mx-auto aspect-[3/4] w-full max-w-[440px]">
      {/* felt oval */}
      <div
        className="absolute inset-x-2 inset-y-8 rounded-[46%] border-[6px] border-[#0a1a30] shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]"
        style={{
          background: 'radial-gradient(ellipse at center, #17406b 0%, #12233f 60%, #0d1b30 100%)',
        }}
      >
        {/* subtle brand rail glow */}
        <div className="pointer-events-none absolute inset-0 rounded-[46%] ring-1 ring-brand/20" />
      </div>

      {/* center: board + pot */}
      <div className="absolute left-1/2 top-[42%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
        <div className="rounded-full bg-black/40 px-3 py-1 text-xs font-bold text-white/90 tabular-nums">
          Pot ₮{state.pot.toLocaleString()}
        </div>
        <div className="flex gap-1.5">
          {state.board.map((c, i) => (
            <PlayingCard key={c} card={c} size="md" index={i} />
          ))}
          {/* placeholders for undealt streets */}
          {Array.from({ length: 5 - state.board.length }).map((_, i) => (
            <div key={`ph-${i}`} className="h-16 w-11 rounded-lg border border-dashed border-white/10" />
          ))}
        </div>
      </div>

      {/* seats */}
      {state.seats.map((seat, i) => {
        const pos = SEAT_POS[i] ?? SEAT_POS[0];
        return (
          <div
            key={seat.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: pos.left, top: pos.top }}
          >
            <PlayerSeat seat={seat} />
          </div>
        );
      })}
    </div>
  );
}
