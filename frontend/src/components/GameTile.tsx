import { motion } from 'motion/react';
import { Users } from 'lucide-react';
import type { GameDef } from '@/lib/games';
import { haptic } from '@/lib/telegram';

/**
 * A game card with its own identity: a soft gradient wash, an oversized glyph
 * watermark, a live-player pill, and the min buy-in. Taps give haptic feedback.
 */
export function GameTile({ game, onClick }: { game: GameDef; onClick?: () => void }) {
  const [from, to] = game.gradient;
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={() => {
        haptic('light');
        onClick?.();
      }}
      className="relative flex h-32 flex-col justify-end overflow-hidden rounded-(--radius-app) border border-border p-3 text-left"
      style={{ backgroundColor: 'var(--surface)' }}
    >
      {/* gradient wash */}
      <div
        className="absolute inset-0 opacity-30"
        style={{ backgroundImage: `linear-gradient(150deg, ${from} 0%, ${to} 130%)` }}
      />
      {/* glyph watermark */}
      <div className="pointer-events-none absolute -right-2 -top-3 text-[5.5rem] leading-none opacity-25 blur-[0.5px]">
        {game.glyph}
      </div>

      {game.hot && (
        <span className="absolute left-3 top-3 rounded-full bg-danger/90 px-2 py-0.5 text-[0.6rem] font-bold text-white shadow">
          HOT
        </span>
      )}

      <div className="relative">
        <div className="font-bold leading-tight">{game.name}</div>
        <div className="mt-1 flex items-center gap-2 text-[0.7rem] text-dim">
          <span className="inline-flex items-center gap-1">
            <Users size={12} /> {game.players.toLocaleString()}
          </span>
          <span className="opacity-40">•</span>
          <span>min ₮{game.minBuy}</span>
        </div>
      </div>
    </motion.button>
  );
}
