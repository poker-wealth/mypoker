import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { GameDef } from '@/lib/games';
import { haptic } from '@/lib/telegram';
import { formatMicros } from '@/api/lobby';

/**
 * One game card in the Games grid.
 *
 * SHAPE — the card is sized by ASPECT RATIO, never by a fixed pixel height.
 * It used to be `h-36` (144px) in a grid column about 114px wide, which is a
 * 0.79 portrait rectangle; the design's card is close to square and carries an
 * extra line of content, so ours read as both taller and emptier than it. A
 * ratio also guarantees the thing the design actually needs: every card in the
 * grid is identical regardless of how long its name is or whether its figures
 * have loaded, because none of that can push the height around.
 *
 * Tune TILE_RATIO alone to change the proportion — nothing else depends on it.
 *
 * FIGURES — `tables` and `jackpot` are live values from the lobby. They were
 * previously read from a hardcoded `players` field in lib/games.ts holding the
 * design document's own numbers (2,541 / 856 / 624 …), so the screen showed
 * invented counts as live ones. There is nothing to fall back to now: when the
 * lobby has not answered, the card shows a dash rather than a number.
 */

/** width / height. 6:7 ≈ 0.857 — near-square, with room for three text rows. */
const TILE_RATIO = '6/7';

export interface GameTileProps {
  game: GameDef;
  /** Live table count for this game. Undefined until the lobby answers. */
  tables?: number;
  /** Live pooled jackpot for this game, micro-USD. */
  jackpot?: number;
  onClick?: () => void;
}

export function GameTile({ game, tables, jackpot, onClick }: GameTileProps) {
  const { t } = useTranslation();

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={() => {
        haptic('light');
        onClick?.();
      }}
      style={{ aspectRatio: TILE_RATIO, backgroundColor: 'var(--surface)' }}
      className="relative flex w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-border px-2 py-3 text-center"
    >
      <div className="flex h-10 w-full items-center justify-center drop-shadow-md">
        {game.image ? (
          <img
            src={game.image}
            alt=""
            className="h-full object-contain mix-blend-screen"
          />
        ) : (
          <span className="text-3xl leading-none">{game.glyph}</span>
        )}
      </div>

      <div className="w-full truncate text-[0.72rem] font-bold leading-tight text-text">
        {t(`gameNames.${game.id}`, { defaultValue: game.name })}
      </div>

      <div className="text-[0.6rem] leading-none text-dim">
        {tables === undefined ? '—' : t('games.tableCount', { count: tables })}
      </div>

      {/* The gold figure is this game's pooled jackpot across its tables. Shown
          only when there is one — a "$0.00" on every card is noise, and on a
          game with no pool it would be a promise of nothing. */}
      {jackpot !== undefined && jackpot > 0 && (
        <div className="text-[0.62rem] font-bold leading-none tabular-nums text-jackpot">
          ${formatMicros(jackpot, 2)}
        </div>
      )}
    </motion.button>
  );
}
