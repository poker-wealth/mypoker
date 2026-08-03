import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Volume2, Settings2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { PokerTable } from '@/components/poker/PokerTable';
import { ActionBar } from '@/components/poker/ActionBar';
import { GAMES } from '@/lib/games';
import { useDemoHand } from '@/hooks/useDemoHand';

export function Table() {
  const navigate = useNavigate();
  const { id } = useParams();
  const game = GAMES.find((g) => g.id === id);
  const { view, heroAct, heroToAct } = useDemoHand();

  return (
    <div
      className="flex min-h-full flex-col"
      style={{ background: 'radial-gradient(ellipse at top, #14142a 0%, var(--bg) 70%)' }}
    >
      {/* top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="grid size-9 place-items-center rounded-full border border-border bg-surface active:scale-95"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <div className="text-sm font-bold">{game?.name ?? 'Texas Hold’em'}</div>
          <div className="text-[0.66rem] text-dim">Hand {view.handId} · Blinds ₮10/20</div>
        </div>
        <div className="flex gap-2">
          <button className="grid size-9 place-items-center rounded-full border border-border bg-surface text-dim active:scale-95">
            <Volume2 size={16} />
          </button>
          <button className="grid size-9 place-items-center rounded-full border border-border bg-surface text-dim active:scale-95">
            <Settings2 size={16} />
          </button>
        </div>
      </div>

      {/* table */}
      <div className="flex flex-1 items-center px-3">
        <PokerTable state={view} />
      </div>

      {/* result banner */}
      <AnimatePresence>
        {view.handOver && view.message && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mx-auto mb-2 rounded-full px-4 py-1.5 text-sm font-semibold text-white shadow-lg"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          >
            {view.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* action bar */}
      <div className="border-t border-border bg-surface/80 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur">
        {heroToAct ? (
          <ActionBar state={view} onAction={heroAct} />
        ) : (
          <div className="py-3 text-center text-sm text-dim">
            {view.handOver ? 'Next hand starting…' : 'Waiting for other players…'}
          </div>
        )}
      </div>
    </div>
  );
}
