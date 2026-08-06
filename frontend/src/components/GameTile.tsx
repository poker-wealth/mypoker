import { motion } from 'motion/react';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GameDef } from '@/lib/games';
import { haptic } from '@/lib/telegram';

/**
 * A game card with its own identity: a soft gradient wash, an oversized glyph
 * watermark, a live-player pill, and the min buy-in. Taps give haptic feedback.
 */
export function GameTile({ game, onClick }: { game: GameDef; onClick?: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={() => {
        haptic('light');
        onClick?.();
      }}
      className="relative flex h-36 flex-col items-center justify-between overflow-hidden rounded-2xl border border-border p-3 text-center"
      style={{ backgroundColor: 'var(--surface)' }}
    >
      {game.hot && (
        <span className="absolute left-2 top-2 rounded-full bg-danger/90 px-1.5 py-0.5 text-[0.55rem] font-bold text-white shadow">
          HOT
        </span>
      )}

      {/* glyph / icon area */}
      <div className="flex h-12 w-full items-center justify-center drop-shadow-md">
        {game.image ? (
          <img src={game.image} alt={game.name} className="h-full object-contain mix-blend-screen" />
        ) : (
          <span className="text-4xl">{game.glyph}</span>
        )}
      </div>

      <div className="mt-2 flex w-full flex-col items-center gap-1">
        <div className="text-[0.75rem] font-bold leading-tight text-text line-clamp-1 w-full px-1">
          {t(`gameNames.${game.id}`, { defaultValue: game.name })}
        </div>
        <div className="text-[0.65rem] text-dim">
          {game.players.toLocaleString()} tables
        </div>
        <div className="text-[0.7rem] font-bold text-yellow-500">
          {/* Mocked amounts for now to match UI */}
          ${(game.players * 49.35).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
    </motion.button>
  );
}
