import { motion } from 'motion/react';
import { ShieldCheck, Flame, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { GameTile } from '@/components/GameTile';
import { GAMES, totalPlayers } from '@/lib/games';

export function Lobby() {
  const navigate = useNavigate();
  const hot = GAMES.filter((g) => g.hot);
  const rest = GAMES.filter((g) => !g.hot);

  return (
    <div className="space-y-5">
      {/* Jackpot hero */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-5"
        style={{ boxShadow: 'var(--glow-brand)' }}
      >
        <div className="absolute inset-0" style={{ backgroundImage: 'var(--brand-gradient)', opacity: 0.9 }} />
        {/* moving shimmer */}
        <motion.div
          className="absolute inset-y-0 w-1/3 bg-white/20 blur-2xl"
          initial={{ x: '-120%' }}
          animate={{ x: '360%' }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.5 }}
        />
        <div className="relative text-white">
          <div className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-white/80">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex size-2 rounded-full bg-white" />
            </span>
            Daily Jackpot
          </div>
          <div className="mt-1 text-[2.6rem] font-black leading-none tracking-tight tabular-nums">
            ₮128,450
          </div>
          <div className="mt-2 text-xs text-white/75">Grows with every hand played across MYPOKER.</div>
        </div>
      </div>

      {/* Live players band */}
      <div className="flex items-center justify-between rounded-(--radius-app) border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck size={18} className="text-accent" />
          <span className="text-dim">Provably fair · verifiable on-chain</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="size-2 rounded-full bg-success" />
          {totalPlayers().toLocaleString()}
          <span className="text-dim">online</span>
        </div>
      </div>

      {/* Hot now */}
      <section>
        <div className="mb-2.5 flex items-center gap-1.5">
          <Flame size={16} className="text-danger" />
          <h2 className="text-sm font-bold">Hot right now</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {hot.map((g) => (
            <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
          ))}
        </div>
      </section>

      {/* All games */}
      <section>
        <button
          onClick={() => navigate('/games')}
          className="mb-2.5 flex w-full items-center justify-between"
        >
          <h2 className="text-sm font-bold">More games</h2>
          <span className="flex items-center text-xs text-dim">
            See all <ChevronRight size={14} />
          </span>
        </button>
        <div className="grid grid-cols-2 gap-3">
          {rest.map((g) => (
            <GameTile key={g.id} game={g} onClick={() => navigate(`/table/${g.id}`)} />
          ))}
        </div>
      </section>
    </div>
  );
}
